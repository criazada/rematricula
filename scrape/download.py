from tipos import *
import requests
import requests.utils
import urllib.parse
import re
import shelve
import html
import os

csrf = ''

s = requests.Session()
s.cookies['cookie_sig'] = ''
s.cookies['SIMPSESSID'] = ''
s.cookies['expandir'] = '0'
s.cookies['cookie_simp'] = ''
s.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0'

oferta_re = re.compile(r'<a href=".*?/consultar_horario_disciplina\.php\?cod_oferta_disciplina=(?P<cod>.*?)&op=(abrir|fechar)" title="(?P<nome>.*?) ?">.*?</a>')
nome_re = re.compile(r'^(?P<disc>\w+) - (?P<nome>.*?) - (?P<turma>[\w ()]+)$')
info_re = re.compile(r'<p><strong>(?P<tipo>.*?):</strong> (?P<valor>.*?)</p>')
linha_horario_re = re.compile(r'<tr>(?!<th)(.*?)</tr>')
horario_re = re.compile(r'<td>(.*?)</td>')
local_re = re.compile(r'<abbr title="(?P<desc>.*?) ?">(?P<abbr>.*?)</abbr>')

base_url = 'https://sig.ufla.br/modulos/alunos/rematricula/consultar_horario_disciplina.php'

def pesquisa(cod):
    d = {
        'pesquisar_matriz': 0,
        'modulo': 6,
        'codigo': cod,
        'nome_disciplina': '',
        'bimestre': 'T',
        'token_csrf': csrf,
        'enviar': 'Consultar'
    }

    return urllib.parse.urlencode(d)

def dump_ofertas(disc=''):
    r = s.post(f'{base_url}', data=pesquisa(disc), headers={'Content-Type': 'application/x-www-form-urlencoded'})
    if r.status_code != 200:
        raise RuntimeError("a")
    text = html.unescape(r.text)
    ofertas = oferta_re.findall(text)
    return [(cod, nome) for cod, _, nome in ofertas]

def mat(v):
    of, oc, res, pend, raz = [u[1].strip('*') for u in v]
    return Matricula(int(of), int(oc), int(res), int(pend), float(raz))

def c_dia(dia: str):
    dia = dia.lower()
    if dia == 'sem dia definido':
        return None

    m = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
    return m.index(dia)

def hora2int(hora):
    h, m = [int(p) for p in hora.split(':')]
    return h * 60 + m

def c_hora(hora: str):
    return Hora(*[hora2int(h) for h in hora.split(' - ')])

def desc_ofertas(disc):
    ofertas = dump_ofertas(disc)
    descs = []

    for cod, _ in ofertas:
        url = f'{base_url}?cod_oferta_disciplina={cod}'
        r = s.get(f'{url}&op=abrir')
        if r.status_code != 200:
            print(f'!!!abrir {disc} {cod}')
        if s.get(f'{url}&op=fechar').status_code != 200:
            print(f'!!!fechar {disc} {cod}')

        text = html.unescape(r.text)
        infos = info_re.findall(text)

        turma, curso, situacao = [infos[i][1] for i in range(0, 3)]

        normal = mat(infos[3:8])
        especial = mat(infos[8:13])

        horarios = []
        for horario in linha_horario_re.findall(text):
            local, maximo, ocupacao, tipo, dia, hora = horario_re.findall(horario)
            desc, abbr = local_re.match(local).groups()
            local = Local(desc, abbr)
            ocupacao = int(ocupacao)
            dia = c_dia(dia)
            if hora != 'Sem horário definido':
                hora = c_hora(hora)
            else:
                print("!!!hora")
                hora = None
            horarios.append(Horario(local, maximo, ocupacao, tipo, dia, hora))

        desc = Descricao(turma, curso, situacao, normal, especial, horarios)
        descs.append(desc)
    return descs

f = '2023-04-01'

if __name__ == '__main__':
    force_update = False
    os.makedirs(f, exist_ok=True)

    with shelve.open(f'{f}/ofertas') as ofertas, \
        shelve.open(f'{f}/disciplinas') as disciplinas:

        if force_update or not ofertas.keys():
            disciplinas.clear()
            for cod, nome in dump_ofertas():
                print(nome)
                disc, nome, turma = nome_re.match(nome).groups()
                ofertas[cod] = Oferta(cod, disc, nome, turma)

        for i, (_, disc, nome, _) in enumerate(ofertas.values()):
            if disc not in disciplinas:
                print(f'{i+1}/{len(ofertas)} {disc} {nome}')
                descs = desc_ofertas(disc)
                disciplinas[disc] = Disciplina(disc, nome, descs)
