const reservedState = [];
const numCells = 7 * 16; // 7 dias, 16 horários
const dados = {};

const elements = {
    model: null,
    toclone: null,
    topaste: null,
    ofmodel: null,
    total: null,
    totalg: null,
    done: null,
    generate: null,
    lotadas: null,
};

var solver;
var nsolutions = 0;

const regexes = [
    /^(?<disc>[A-Z]+\d+)\s*-\s*(?<nome>.*?)\s*(?<turma>[A-Z0-9]+)\s*(?:Obrigatória|Eletiva)/i,
    /^\s*(?<disc>[A-Z]+\d+)\s*-\s*(?<nome>.*?)\s*-\s*(?<turma>[A-Z0-9]+)\s*(?:(?:Abrir|Fechar) detalhes)/i,
    /^(?<disc>[A-Z]+\d+)\s*\((?<turma>[A-Z0-9]+)\)$/i,
    /^(?<disc>[A-Z]+\d+)(?:-|:)(?<turma>[A-Z0-9]+)\s*(?:-\s*(?<nome>.*?))?$/i,
];

async function main() {
    await loadDados();
    initElements();

    solver = new Worker('solver.js');
    solver.addEventListener('message', handleMessage);
}

function initElements() {
    for (const name in elements) {
        elements[name] = document.getElementById(name);
    }

    const tds = removeTimeTds([...elements.model.getElementsByTagName('td')]);
    for (const [i, td] of Object.entries(tds)) {
        td.addEventListener('click', handleClick.bind({}, i));
    }

    elements.generate.addEventListener('click', startSolving);
    elements.lotadas.addEventListener('click', removeLotadas);

    initInputs();
}

function handleClick(i) {
    reservedState[i] = 1 - reservedState[i];
    syncInput('reservedstt');
}

function handleMessage(e) {
    const {done, solutions, total} = e.data;
    const el = elements;

    if (done) {
        console.log('done');
        el.done.className = '';
    } else if (solutions) {
        el.done.className = 'hidden';
        
        if (nsolutions > 500) return;
        
        for (const [i, [solution, creds]] of Object.entries(solutions)) {
            if (i == 100) break;

            const clone = el.toclone.cloneNode(true);
            clone.className = '';
            updateTable(clone, solution);
            el.topaste.appendChild(clone);
        }

        nsolutions += solutions.length;
        el.totalg.parentNode.className = '';
        el.totalg.innerText = nsolutions.toString();
    } else if (total) {
        console.log(total);
        el.total.parentNode.className = '';
        el.total.innerText = total.toString();
    }
}

function startSolving() {
    nsolutions = 0;
    solver.postMessage({run: false});
    elements.total.parentNode.className = 'hidden';

    removeChildren(elements.topaste);

    const ofertas = getInput('disponiveis');
    const desejadas = getInput('desejadas');
    const [cmin, cmax, bmin, bmax] = ['mincreditos', 'maxcreditos', 'minburaco', 'maxburaco'].map(getInput);
    const constraints = {cmin, cmax, bmin, bmax};

    solver.postMessage({solve: true, ofertas, desejadas, constraints});
}

function removeLotadas() {
    const disponiveis = [];

    for (const oferta of getInput('disponiveis')) {
        if (oferta.restantesN) disponiveis.push(oferta);
    }

    updatePreferencias(inputs.disponiveis.element, 'disponiveis', disponiveis);
    inputs.disponiveis.value = disponiveis;
}

async function loadDados() {
    const r = await fetch('ofertadas.json');
    const d = await r.json();

    const salas = {};
    const cursos = d.c;
    const turmascursos = {};
    const disciplinas = {};

    for (const [salaidx, [nome, abbr]] of Object.entries(d.s)) {
        const sala = {
            nome,
            abbr
        };

        salas[salaidx] = sala;
        salas[sala] = sala;
    }

    for (const [turmaidx, [nome, cursoidx]] of Object.entries(d.t)) {
        const turmacurso = {
            nome,
            curso: cursos[cursoidx]
        };

        turmascursos[turmaidx] = turmacurso;
        turmascursos[nome] = turmacurso;
    }

    for (const [codigo, [nome, ofertasdisc]] of Object.entries(d.d)) {
        const ofertas = {};
        for (const [turmaidx, restantesN, restantesE, horarios] of ofertasdisc) {
            const newhorarios = horarios.map(h => ({
                    sala: salas[h[0]],
                    tipo: h[1],
                    dia: h[2],
                    inicio: h[3],
                    fim: h[4]
                })
            );

            const nh = newhorarios.map(h => {
                const d = h.dia * 1000 + h.inicio;
                return [h.dia, h.inicio, h.fim, d, codigo];
            });

            const turma = turmascursos[turmaidx];
            ofertas[turma.nome] = {
                turma: turma.nome,
                disciplina: codigo,
                horarios: newhorarios,
                restantesN,
                restantesE,
                nh
            };
        }

        disciplinas[codigo] = {
            codigo,
            nome,
            ofertas
        };
    }

    disciplinas['R'] = {
        codigo: 'R',
        nome: 'Reservado',
        ofertas: {
            0: {
                disciplina: 'R',
                codigo: 0,
                horarios: []
            }
        }
    };

    dados.salas = salas;
    dados.cursos = cursos;
    dados.turmascursos = turmascursos;
    dados.disciplinas = disciplinas;
    dados.reservado = disciplinas['R'].ofertas[0];
}

function indexToDiaHora(i) {
    return [i % 7, Math.floor(i / 7 + 7) * 6];
}

function diaHoraToIndex(dia, hora) {
    return (Math.floor(hora / 6) - 7) * 7 + dia;
}

function updatePreferencias(element, tipo, override) {
    const prefs = override ? override : [];
    const disciplinas = dados.disciplinas;

    const lines = element.value.split('\n');

    const dedup = new Set(prefs.map(v => v.disciplina));

    if (prefs.length === 0) {
        for (const line of lines) {
            var reg = undefined;
            for (const regex of regexes) {
                if (regex.test(line)) {
                    reg = regex;
                    break;
                }
            }

            if (reg === undefined) continue;

            var {disc, nome, turma} = line.match(reg).groups;
            if (disc === undefined) continue;
            if (turma === undefined) continue;

            disc = disc.toUpperCase();
            turma = turma.toUpperCase();
            if (dedup.has(disc + turma)) continue;
            dedup.add(disc + turma);

            const disciplina = disciplinas[disc];

            const oferta = disciplina.ofertas[turma];
            if (oferta === undefined) continue;
            if (nome === undefined) {
                nome = disciplina.nome;
            }

            prefs.push(oferta);
        }
    }

    const nlines = prefs.map((o) => `${o.disciplina}-${o.turma} - ${disciplinas[o.disciplina].nome}`);
    var txt = nlines.join('\n');
    if (txt !== '') {
        txt += '\n';
    }

    element.value = txt;
    if (tipo === 'desejadas') {
        prefs.push(dados.reservado);
        updateTable(elements.model, prefs, prefs);
    }

    return prefs;
}

function updateReservedState(element) {
    if (reservedState.length === 0) {
        for (const c of element.value) {
            reservedState.push(parseInt(c));
        }

        for (var i = reservedState.length; i < numCells; i++) {
            const [dia, hora] = indexToDiaHora(i);
            if (hora == 12*6 && dia != 0 && dia != 6) {
                reservedState.push(1);
            } else {
                reservedState.push(0);
            }
        }
    }

    const horarios = [];
    for (const [i, v] of Object.entries(reservedState)) {
        if (v) {
            const [dia, hora] = indexToDiaHora(i);
            horarios.push({
                sala: null,
                tipo: 1,
                dia,
                inicio: hora,
                fim: hora + 4
            });
        }
    }

    const nh = horarios.map(h => {
        const d = h.dia * 1000 + h.inicio;
        return [h.dia, h.inicio, h.fim, d, 'R'];
    });

    dados.reservado.horarios = horarios;
    dados.reservado.nh = nh;

    element.value = reservedState.join('');
    updateTable(elements.model, getInput('desejadas'));

    return element.value;
}

function removeTimeTds(tds) {
    const n = [];
    for (const [i, td] of Object.entries(tds)) {
        if (i % 8 == 0) continue;
        n.push(td);
    }
    return n;
}

function removeChildren(elem) {
    while (elem.firstChild) {
        elem.removeChild(elem.firstChild);
    }
}

function createOfertaElem(oferta, nova) {
    const model = elements.ofmodel.cloneNode(true);
    const [codigo, turma] = model.getElementsByTagName('abbr');

    const [dash] = model.getElementsByTagName('span');

    codigo.innerText = oferta.disciplina;
    codigo.setAttribute('title', dados.disciplinas[oferta.disciplina].nome);

    if (oferta.disciplina !== 'R') {
        turma.innerText = oferta.turma;
        turma.setAttribute('title', dados.turmascursos[oferta.turma].curso);
    } else {
        dash.className = 'hidden';
    }

    model.className = nova ? 'n' : '';
    return model;
}

function updateTable(table, ofertas, desejadas) {
    if (desejadas === undefined) {
        desejadas = getInput('desejadas');
    }

    const tds = removeTimeTds([...table.getElementsByTagName('td')]);
    tds.forEach(removeChildren);

    for (const oferta of ofertas) {
        var desejada = desejadas.some(
            d => d.disciplina === oferta.disciplina && d.turma === oferta.turma
        );

        for (const {dia, inicio, fim} of oferta.horarios) {
            for (var hora = inicio; hora < fim; hora += 6) {
                const td = tds[diaHoraToIndex(dia, hora)];

                const elem = createOfertaElem(oferta, !desejada);

                td.appendChild(elem);
            }
        }
    }

    for (const td of tds) {
        const len = td.childNodes.length;
        if (len > 1) {
            td.className = 'conflict';
        } else if (len == 1) {
            if (td.getElementsByClassName('n').length) {
                td.className = 'new';
            } else {
                td.className = 'reserved';
            }
        } else {
            td.className = '';
            td.innerText = '-';
        }
    }
}

function generateCsv(table) {
    const tds = table.getElementsByTagName('td');
    const ths = table.getElementsByTagName('th');

    var txt = '';

    for (const [i, th] of Object.entries(ths)) {
        txt += `"${th.innerText}"`;
        if (i != 7) {
            txt += ',';
        }
    }

    txt += '\r\n';

    for (const [i, td] of Object.entries(tds)) {
        const children = td.childNodes;
        if (children.length > 0) {
            var lines = [];
            for (const child of children) {
                if (child.nodeName === '#text') {
                    lines.push(child.textContent);
                } else {
                    const [disc, turma] = child.getElementsByTagName('abbr');
                    const cod = disc.innerText;
                    const nome = disc.getAttribute('title');
                    const codturma = turma.innerText ? `-${turma.innerText}` : '';
                    lines.push(`${cod}${codturma} - ${nome}`);
                }
            }
            txt += `"${lines.join('\n')}"`;
        } else {
            txt += `"${td.innerText}"`;
        }
        if (i % 8 == 7) {
            txt += '\r\n';
        } else {
            txt += ',';
        }
    }

    return txt;
}

function mkInput(update, defaultValue) {
    return {
        update,
        value: defaultValue,
        element: null
    };
}

const inputs = {
    mincreditos: mkInput(e => parseInt(e.value), 0),
    maxcreditos: mkInput(e => parseInt(e.value), 0),
    minburaco:   mkInput(e => parseInt(e.value)*6+2, 0),
    maxburaco:   mkInput(e => parseInt(e.value)*6+2, 0),
    desejadas:   mkInput(e => updatePreferencias(e, 'desejadas'), []),
    disponiveis: mkInput(e => updatePreferencias(e, 'disponiveis'), []),
    reservedstt: mkInput(e => updateReservedState(e), '')
};

function syncInput(name) {
    const input = inputs[name];
    if (input !== undefined) {
        const {element} = input;
        if (element) {
            input.value = input.update(element);
        }
    }
}

function getInput(name) {
    const input = inputs[name];
    if (input !== undefined) {
        return input.value;
    }
}

function initInputs() {
    for (const [name, input] of Object.entries(inputs)) {
        const element = document.getElementById(name);
        if (element) {
            element.addEventListener('change', syncInput.bind({}, name));
        }
        input.element = element;
        syncInput(name);
    }
}

window.addEventListener('load', main);
