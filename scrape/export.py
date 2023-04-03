from tipos import *
import shelve
import json

f = '2023-04-01'

if __name__ == '__main__':
    with shelve.open(f'{f}/disciplinas') as disciplinas, \
        open(f'{f}/ofertadas.json', 'w') as jraw:

        turmas = {}
        cursos = {}
        salas = {}

        ndiscs = {}
        for disc in disciplinas.values():
            ofertas = []
            for turma, curso, _, normal, especial, horarios in disc.ofertas:
                turmaidx = turmas[turma][0] if turma in turmas else len(turmas)
                cursoidx = cursos[curso] if curso in cursos else len(cursos)
                cursos[curso] = cursoidx
                turmas[turma] = (turmaidx, cursoidx)

                nhorarios = []
                for (desc, abbr), _, _, t, d, h in horarios:
                    salaidx = salas[abbr][0] if abbr in salas else len(salas)
                    salas[abbr] = (salaidx, (desc, abbr))

                    if t == 'Prática':
                        t = 0
                    elif t == 'Teórica':
                        t = 1
                    else:
                        print(t)
                    if h != None:
                        s, e = h
                        nhorarios.append([
                            salaidx, t, d, s//10, e//10
                        ])
                ofertas.append([turmaidx, normal.restantes, especial.restantes, nhorarios])

            ndiscs[disc.disc] = [
                disc.nome,
                ofertas
            ]
        turmas = [(k, v[1]) for k, v in turmas.items()]
        cursos = list(cursos.keys())
        salas = [(s[1][1], s[1][0]) for s in salas.values()]
        f = {
            'd': ndiscs,
            't': turmas,
            'c': cursos,
            's': salas,
        }
        json.dump(f, jraw, separators=(',', ':'))
