var runWorker = true;
var running = false;

function fixHorario(oferta) {
    const newhorarios = [];
    for (const h of oferta.horarios) {
        const d = h.dia * 1000 + h.inicio;
        newhorarios.push([h.dia, h.inicio, h.fim, d, oferta.disc]);
    }
    oferta.nh = newhorarios;

    return oferta;
}

function solve(ofertas, desejadas, constraints) {
    const disponiveis = [];
    const base = [...desejadas].map(fixHorario);
    for (const o of ofertas) {
        var found = false;
        for (const desejada of desejadas) {
            if (o.disc === desejada.codigo) {
                found = true;
                break;
            }
        }
        if (!found) {
            disponiveis.push(fixHorario(o));
        }
    }

    return [[disponiveis, base, mkcasodisc(base), constraints, horariosDoCaso(base)]];
}

function mkcasodisc(caso) {
    return new Set(caso.map(v => v.disc));
}

function solvestep(casos) {
    return casos.map(saved => stepcaso(...saved)).flat();
}

function stepcaso(disponiveis, caso, casodisc, constraints) {
    const newdisponiveis = [];
    var novo = [...caso];
    for (const disponivel of disponiveis) {
        if (casodisc.has(disponivel.disc)) continue;
        novo.push(disponivel);
        const horarios = horariosDoCaso(novo);
        if (verify(horarios, constraints)) {
            newdisponiveis.push([horarios, disponivel]);
        }
        novo.pop();
    }

    const valid = [];
    while (newdisponiveis.length && runWorker) {
        const [horarios, disponivel] = newdisponiveis.pop();
        const subdisponiveis = newdisponiveis.map(v => v[1]);
        const sub = [...caso, disponivel];
        valid.push([subdisponiveis, sub, mkcasodisc(sub), constraints, horarios]);
    }
    return valid;
}

function horariosDoCaso(caso) {
    return caso.map(oferta => oferta.nh).flat().sort((a, b) => a[3] - b[3]);
}

function hasConflito(horarios) {
    for (var i = 1; i < horarios.length; i++) {
        const a = horarios[i-1];
        const b = horarios[i];

        if (a[0] === b[0]) {
            const d = b[1]-a[2];
            if (d < 0) {
                return true;
            }
        }
    }
    return false;
}

function hasBuraco(horarios, constraints) {
    const {bmin, bmax} = constraints;
    for (var i = 1; i < horarios.length; i++) {
        const a = horarios[i-1];
        const b = horarios[i];

        if (a[0] === b[0]) {
            const d = b[1]-a[2];
            if (d > 2 && d >= bmin && d < bmax) {
                return true;
            }
        }
    }
    return false;
}

function creditos(horarios) {
    var sum = 0;
    for (const h of horarios) {
        if (h[4] !== 'R') {
            sum += Math.round((h[2]-h[1])/5);
        }
    }
    return sum;
}

function verify(horarios, constraints) {
    const {cmax} = constraints;

    if (hasConflito(horarios)) return false;

    var creds = creditos(horarios);
    var buraco = hasBuraco(horarios, constraints);

    if (creds > cmax) return false;
    if (creds == cmax && buraco) return false;
    return true;
}

onmessage = function(e) {
    if (e.run) {
        runWorker = e.run;
    }

    if (e.solve) {
        if (running) {
            postMessage({running});
        }
    }
}
