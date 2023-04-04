import argparse
import sys
import datetime
import requests
import logging
import dataclasses
import html
import html.parser
import traceback
import re
from logging import info, debug
from urllib.parse import urlencode

DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0'
DEFAULT_SIG_URL = 'https://sig.ufla.br{path}'
DEFAULT_SIG_MODULES = {
    'index': '/',
    'login': '/modulos/login/index.php',
    'logout': '/modulos/login/sair.php',
    'rematricula': '/modulos/alunos/rematricula/index.php',
    'consultar': '/modulos/alunos/rematricula/consultar_horario_disciplina.php'
}

oferta_re = re.compile(r'^(?P<disc>\w+) - (?P<nome>.*?) - (?P<turma>\w+)( \(((?P<bimestre>\d)º Bimestre|(?P<semestral>Semestral))\))?\s*$')
cod_oferta_re = re.compile(r'.*?cod_oferta_disciplina=(?P<cod>.*?)&op=(abrir|fechar).*')

@dataclasses.dataclass(init=False)
class OfertaHead:
    cod: str
    disc: str
    nome: str
    turma: str
    bimestre: str | None
    semestral: bool

    def __init__(self, url: str, title: str) -> None:
        m = oferta_re.match(title)
        c = cod_oferta_re.match(url)
        if m is None:
            raise ValueError(f'{title} is not a valid offer name')
        if c is None:
            raise ValueError(f'{url} is not a valid offer URL')
        self.cod = c.group('cod')
        self.disc = m.group('disc')
        self.nome = m.group('nome')
        self.turma = m.group('turma')
        self.bimestre = m.group('bimestre')
        self.semestral = m.group('semestral') is not None

@dataclasses.dataclass(init=False)
class MatInfo:
    vagas_oferecidas: int
    vagas_ocupadas: int
    vagas_restantes: int
    solicitacoes_pendentes: int
    candidatos_por_vaga: float | None

    def __init__(self, mat_info: dict[str, str]) -> None:
        self.vagas_oferecidas = int(mat_info['Vagas oferecidas'])
        self.vagas_ocupadas = int(mat_info['Vagas ocupadas'])
        self.vagas_restantes = int(mat_info['Vagas restantes'])
        self.solicitacoes_pendentes = int(mat_info['Solicitações Pendentes'])
        self.candidatos_por_vaga = None

@dataclasses.dataclass(init=False)
class Dia:
    num: int | None

    def __init__(self, dia: str) -> None:
        dia = dia.lower()
        if dia == 'sem dia definido':
            self.num = None
            return

        dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
        self.num = dias.index(dia)

@dataclasses.dataclass(init=False)
class Horario:
    minuto: int | None

    def __init__(self, hora: str) -> None:
        h, m = [int(x) for x in hora.split(':')]
        self.minuto = h * 60 + m

@dataclasses.dataclass(init=False)
class HorarioLocal:
    local: str
    abbr: str
    maximo: bool
    ocupacao: int
    tipo: str
    dia: Dia
    inicio: Horario | None
    fim: Horario | None

    def __init__(self, info: list[str]) -> None:
        self.local = info[0]
        self.abbr = info[1]
        self.maximo = info[2] == 'Sim'
        self.ocupacao = int(info[3])
        self.tipo = info[4]
        self.dia = Dia(info[5])
        if info[6] == 'Sem horário definido':
            self.inicio = None
            self.fim = None
            return
        horas = info[6].split(' - ')
        self.inicio = Horario(horas[0])
        self.fim = Horario(horas[1])

@dataclasses.dataclass(init=False)
class Oferta:
    head: OfertaHead
    situacao: str
    normal: MatInfo
    especial: MatInfo
    horarios: list[HorarioLocal]

    def __init__(self,
                 head: OfertaHead,
                 info: dict[str, str],
                 normal: dict[str, str],
                 especial: dict[str, str],
                 horarios: list[list[str]]) -> None:
        self.head = head
        self.situacao = info['Situação']
        self.normal = MatInfo(normal)
        self.especial = MatInfo(especial)
        self.horarios = [HorarioLocal(h) for h in horarios]

class ConsultaParser(html.parser.HTMLParser):
    def reset(self) -> None:
        super().reset()
        self.ofertas: list[OfertaHead] = []
        self.csrf: None | str = None

    def handle_atag(self, attrs: list[tuple[str, str | None]]) -> None:
        title = None
        url = None
        for k, v in attrs:
            if v is None: continue
            if k == 'href' and 'cod_oferta_disciplina' in v:
                url = v
            if k == 'title':
                title = v
        if not title or not url: return
        self.ofertas.append(OfertaHead(url, title))

    def handle_inputtag(self, attrs: list[tuple[str, str | None]]) -> None:
        is_token = False
        token = None
        for k, v in attrs:
            if (k, v) == ('name', 'token_csrf'):
                is_token = True
            if k == 'value':
                token = v
        if not is_token or not token: return
        self.csrf = token

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == 'a': self.handle_atag(attrs)
        if tag == 'input': self.handle_inputtag(attrs)

class OfertaParser(html.parser.HTMLParser):
    def reset(self) -> None:
        super().reset()
        self.info = {}
        self.info_normal = {}
        self.info_especial = {}
        self.extra_info = {}
        self._current_info = self.info
        self._current_data = None
        self._inside = {
            'p': False,
            'strong': False,
            'tr': False,
            'td': False,
            'abbr': False,
            'thead': False,
        }
        self.rows = []
        self._current_row = []
        self._current_abbr = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._inside: self._inside[tag] = True
        if tag == 'fieldset':
            for attr in attrs:
                if attr == ('class', 'vagas_normais'):
                    self._current_info = self.info_normal
                elif attr == ('class', 'vagas_especiais'):
                    self._current_info = self.info_especial
        if tag == 'abbr':
            for k, v in attrs:
                if k == 'title':
                    self._current_abbr = v

    def handle_endtag(self, tag: str) -> None:
        if tag in self._inside: self._inside[tag] = False
        if tag == 'p':
            self._current_data = None
        if tag == 'fieldset':
            if self._current_info is self.info_especial:
                self._current_info = self.extra_info

        if tag == 'tr' and not self._inside['thead']:
            self.rows.append(self._current_row)
            self._current_row = []

    def handle_data(self, data: str) -> None:
        if self._inside['p'] and self._inside['strong']:
            self._current_data = data
        if self._inside['p'] and self._current_data:
            self._current_info[self._current_data[:-1]] = data.strip()

        if self._inside['td'] and self._inside['abbr']:
            self._current_row.append(self._current_abbr)
        if self._inside['td']:
            self._current_row.append(data)

class Scraper:
    def __init__(self,
                 user: str,
                 password: str,
                 *,
                 sig_url: str = DEFAULT_SIG_URL,
                 sig_modules: dict[str, str] = DEFAULT_SIG_MODULES,
                 user_agent: str = DEFAULT_USER_AGENT) -> None:
        self._user = user
        self._password = password
        self._session = requests.Session()
        self._session.headers['User-Agent'] = user_agent
        self._base_url = sig_url
        self._modules = sig_modules
        self._listed_once = False
        self._last_url = None
        self._last_csrf = None
        self._consulta_parser = ConsultaParser()
        self._oferta_parser = OfertaParser()

    def _sig_request(self, method: str, module: str, *args, err_not_ok: bool = True, data = None, headers = None, **kwargs):
        if method == 'POST' and data is not None:
            if headers is None:
                headers = {}
            if isinstance(data, dict):
                data = urlencode(data)
            headers['Content-Type'] = 'application/x-www-form-urlencoded'

        url = self._base_url.format(path=self._modules[module])
        self._last_url = url

        r = self._session.request(
            method,
            url,
            headers=headers,
            data=data,
            *args, **kwargs
        )

        debug(f'sig_request {method} {module} {r.status_code}')
        if err_not_ok and r.status_code != 200:
            raise RuntimeError(f'{method} {module} {r.status_code}')
        return r

    def _sig_get(self, module: str, *args, **kwargs):
        return self._sig_request('GET', module, *args, **kwargs)

    def _sig_post(self, module: str, *args, **kwargs):
        return self._sig_request('POST', module, *args, **kwargs)

    def login(self) -> bool:
        self._sig_get('index')
        self._sig_post(
            'login',
            data={
                'login': self._user,
                'senha': self._password,
                'lembrar_login': 0,
                'entrar': 'Entrar'
            })
        return True

    def get_ofertas(self,
                    matriz: bool = False,
                    modulo: str | int = 'T',
                    disciplina: str | None = None,
                    nome: str | None = None,
                    bimestre: str | None = None) -> list[OfertaHead]:
        if not self._listed_once:
            self._sig_get('rematricula')
            r = self._sig_get('consultar')
            self._listed_once = True

            self._consulta_parser.reset()
            self._consulta_parser.feed(r.text)
            self._last_csrf = self._consulta_parser.csrf

        r = self._sig_post(
            'consultar',
            data={
                'pesquisar_matriz': 1 if matriz else 0,
                'modulo': modulo,
                'codigo': disciplina if disciplina else '',
                'nome_disciplina': nome if nome else '',
                'bimestre': bimestre if bimestre else 'T',
                'token_csrf': self._last_csrf,
                'enviar': 'Consultar'
            }
        )

        self._consulta_parser.reset()
        self._consulta_parser.feed(html.unescape(r.text))
        self._last_csrf = self._consulta_parser.csrf
        self._last_cod = disciplina
        return self._consulta_parser.ofertas[:]

    def get_oferta(self, oferta: OfertaHead) -> Oferta:
        if self._last_cod != oferta.disc:
            self.get_ofertas(disciplina=oferta.disc)

        params = {'cod_oferta_disciplina': oferta.cod}

        self._oferta_parser.reset()
        params['op'] = 'abrir'
        r = self._sig_get('consultar', params=params)

        self._oferta_parser.feed(html.unescape(r.text))
        new_oferta = Oferta(
            oferta,
            self._oferta_parser.info,
            self._oferta_parser.info_normal,
            self._oferta_parser.info_especial,
            self._oferta_parser.rows
        )

        params['op'] = 'fechar'
        self._sig_get('consultar', params=params)
        return new_oferta

    def logout(self) -> bool:
        self._sig_get('logout')
        return True

def main(argv: list[str]):
    parser = argparse.ArgumentParser(
        prog='uflascrape',
        description='Obtenha dados do SIG/UFLA.',
        epilog='''
            Código fonte disponível em https://github.com/criazada/rematricula.
            Suas informações de login são enviadas somente para sig.ufla.br''',
        add_help=False
    )

    parser.add_argument('-h', '--help', help='exibe esta mensagem de ajuda', action='store_true')

    auth = parser.add_argument_group('autenticação', 'opções de autenticação com o SIG').add_mutually_exclusive_group()
    auth.add_argument('-l', '--login', help='seu login do SIG no formato usuario:senha')
    auth.add_argument('--arquivo-login', help='arquivo contendo seu usuário e senha no formato usuario:senha', metavar='ARQUIVO',
                      type=argparse.FileType('r'))

    args = parser.parse_args(argv)

    if args.help:
        parser.print_help()
        return

    user = None
    password = None
    if args.login or args.arquivo:
        t = args.login if args.login else args.arquivo.read()
        parts = t.strip().split()
        user = parts[0]
        password = ':'.join(parts[1:])

    scp = Scraper(args.login, args.senha)
    try:
        print(scp.login())
        ofertas = scp.get_ofertas()
        print(scp.get_oferta(ofertas[0]))
    except:
        traceback.print_exc()
        print(scp.logout())

if __name__ == '__main__':
    main(sys.argv[1:])
