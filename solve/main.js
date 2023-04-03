var turmas = {};
var cursos = {};
var salas = {};
var disciplinas = {};

var desejadas = [];
var disponiveis = [];

var model;

var solver;

async function main() {
    model = document.getElementById('model');
    addClickHandlers();
    await loadDados();
    document.getElementById('desejadas').addEventListener('change', syncDisciplinasDesejadas);
    document.getElementById('disponiveis').addEventListener('change', syncDisciplinasDisponiveis);
    document.getElementById('generate').addEventListener('click', startSolving);

    syncDisciplinasDesejadas();
    syncDisciplinasDisponiveis();
    syncReservedState(model);

    solver = new Worker('solver.js');
    solver.onmessage = handleMessage;
}

function startSolving() {
    solver.postMessage({run: false});

    const toclone = document.getElementById('toclone');
    const e = document.getElementById('topaste');
    while (e.firstChild) {
        e.removeChild(e.firstChild);
    }
    e.appendChild(toclone);

    const bmin = parseInt(document.getElementById('minburaco').value)*6 + 2;
    const bmax = parseInt(document.getElementById('maxburaco').value)*6 + 2;
    const cmin = parseInt(document.getElementById('mincreditos').value);
    const cmax = parseInt(document.getElementById('maxcreditos').value);
    const ofertas = disponiveis.map(v => v[1]);
    const desj = desejadas.map(v => v[1]);
    const constraints = {bmin, bmax, cmin, cmax};

    solver.postMessage({solve: true, ofertas, desejadas: desj, constraints});
}

function handleMessage(e) {
    const d = e.data;
    if (d.done) {
        console.log('done');
    } else {
        for (const solution of d.solutions) {
            const clone = document.getElementById('toclone').cloneNode(true);
            clone.className = '';
            updateTable(clone, solution.map(v => [0, v]));
            document.getElementById('topaste').append(clone);
        }
    }
}

async function loadDados() {
    const r = await fetch('ofertadas.json');
    d = await r.json();

    for (const salaidx in d.n) {
        const sala = {
            nome: d.n[salaidx],
            abbr: d.a[salaidx]
        };
        salas[salaidx] = sala;
        salas[sala.abbr] = sala;
    }

    salas[-1] = {
        nome: 'R',
        abbr: 'ESP'
    };

    cursos = d.c;
    for (const turmaidx in d.t) {
        const [nome, cursoidx] = d.t[turmaidx];
        const turma = {
            nome,
            curso: cursos[cursoidx]
        };
        turmas[turmaidx] = turma;
        turmas[turma.nome] = turma;
    }
    for (const codigo in d.d) {
        const disc = d.d[codigo];
        const ofertas = {};
        for (const o of disc[1]) {
            const horarios = o[1].map(h => {
                return {
                    sala: salas[h[0]],
                    tipo: h[1],
                    dia: h[2],
                    inicio: h[3],
                    fim: h[4]
                }
            });
            const nome = turmas[o[0]].nome;
            ofertas[nome] = {
                codigo: nome,
                disc: codigo,
                horarios
            };
        }
        disciplinas[codigo] = {
            codigo,
            nome: disc[0],
            turmas: ofertas
        }
    }
    disciplinas['R'] = {
        codigo: 'R',
        nome: 'Reservado',
        turmas: {
            '0': {
                disc: 'R',
                codigo: '0',
                horarios: []
            }
        }
    }

    for (var i = 0; i < 7; i++) {
        toggleHorarioReservado(i, 12 * 6);
    }

    const ddt = document.getElementById('todasdt');
    for (const codigo in disciplinas) {
        if (codigo === 'R') continue;

        const disc = disciplinas[codigo];

        for (const turma in disc.turmas) {
            const opturma = document.createElement('option');
            opturma.value = `${disc.codigo}:${turma}`;
            opturma.text = `${disc.codigo}:${turma} - ${disc.nome}`;
            ddt.append(opturma);
        }
    }
}

function parsePreferencia(text, turma) {
    var newText = '';
    const preferencia = [];
    text.split('\n').forEach(line => {
        if (line.indexOf('Abrir detalhes') != -1 || line.indexOf('Fechar detalhes') != -1) {
            const r = line.match(/^\s*(.*?) - (.*?) - (.*?)\s*(Abrir|Fechar) detalhes\s*$/);
            if (!r) return;
            const disc = r[1];
            const nome = r[2];
            const nturma = r[3];
            if (turma === undefined || turma === '' || nturma === turma) {
                newText += `${disc}:${nturma} - ${nome}\n`;
                preferencia.push([disc, disciplinas[disc].turmas[nturma]]);
            }
        } else {
            const r = line.match(/^\s*(.*?)(:(.*?))?(\s*-.*)?\s*$/);
            if (!r) return;
            const disc = r[1];
            const turma = r[3] ? r[3] : 0;
            if (!disc && !turma) return;
            preferencia.push([disc, disciplinas[disc].turmas[turma]]);
            newText += line + '\n';
        }
    });

    return [newText.trim() + '\n', preferencia];
}

function syncDisciplinasDesejadas() {
    const e = document.getElementById('desejadas');
    const turma = document.getElementById('turma').value;
    const [newText, preferencia] = parsePreferencia(e.value, turma);
    desejadas = [['R', disciplinas.R.turmas['0']]].concat(preferencia);
    e.value = newText.trim() + '\n';
    updateTable(model, desejadas);
}

function syncDisciplinasDisponiveis() {
    const e = document.getElementById('disponiveis');
    const [newText, preferencia] = parsePreferencia(e.value);
    disponiveis = preferencia;
    e.value = newText.trim() + '\n';
}

function toggleHorarioReservado(dia, hora) {
    const novo = [];
    var enc = false;
    for (const horario of disciplinas.R.turmas['0'].horarios) {
        if (horario.dia == dia && horario.inicio == hora) {
            enc = true;
        } else {
            novo.push(horario);
        }
    }
    if (!enc) {
        novo.push({
            sala: salas[-1],
            tipo: 1,
            dia,
            inicio: hora,
            fim: hora + 4
        });
    }
    disciplinas.R.turmas['0'].horarios = novo;
}

function handleClick(row, col, ev) {
    toggleHorarioReservado(col, (row+7) * 6);
    updateTable(model, desejadas);
    syncReservedState(model);
}

function reservedStateToString(table) {
    const tds = [...table.getElementsByTagName('td')];
    var res = '';
    for (const i in tds) {
        if (i % 8 == 0) continue;
        if (tds[i].innerText.split('/').some(v => v === 'R')) {
            res += '1';
        } else {
            res += '0';
        }
    }
    return res;
}

function syncReservedState(table) {    
    const e = document.getElementById('reservedstate');
    const t = e.value;
    e.value = reservedStateToString(table);

    disciplinas.R.turmas['0'].horarios = [];
    for (const i in t) {
        if (t[i] === '1') {
            const dia = i % 7;
            const hora = Math.floor(i / 7 + 7) * 6;
            toggleHorarioReservado(dia, hora);
        }
    }

    updateTable(model, desejadas);
}

function updateTable(table, turmas) {
    const tds = [...table.getElementsByTagName('td')];
    for (const i in tds) {
        if (i % 8 == 0) continue;
        const td = tds[i];
        td.className = '';
        td.innerText = '-';
    }
    for (const [, turma] of turmas) {
        if (!turma) continue;

        var desejada = false;
        if (desejadas.some(([, d]) => d.disc === turma.disc && d.codigo === turma.codigo)) {
            desejada = true;
        }

        for (const horario of turma.horarios) {
            const dia = horario.dia;
            for (var hora = horario.inicio; hora < horario.fim; hora += 6) {
                const row = Math.floor(hora/6-7);
                const col = dia + 1;
                const td = tds[row * 8 + col];
                if (td.innerText === '-') td.innerText = '';
                td.innerText += ` ${turma.disc}`;
                if (turma.codigo !== '0') {
                    td.innerText += `:${turma.codigo}`;
                }
                if (td.className !== '') {
                    td.className = 'conflict';
                } else if (desejada) {
                    td.className = 'reserved';
                } else {
                    td.className = 'new';
                }
            }
        }
    }
}

function addClickHandlers() {
    const tds = model.getElementsByTagName('td');
    for (var i = 0; i < tds.length; i++) {
        const row = Math.floor(i / 8);
        const col = (i % 8) - 1;
        if (col == -1) continue;
        tds[i].addEventListener('click', handleClick.bind(undefined, row, col));
    }
}

window.addEventListener('load', () => {
    main();
});
