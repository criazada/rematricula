function stepcaso(disponiveis, caso, constraints) {
    const newdisponiveis = [];
    var novo = [...caso];
    for (const disponivel of disponiveis) {
        if (caso.some(o => o.disciplina === disponivel.disciplina)) continue;
        novo.push(disponivel);
        const horarios = horariosDoCaso(novo);
        if (verify(horarios, constraints)) {
            newdisponiveis.push([horarios, disponivel]);
        }
        novo.pop();
    }

    const valid = [];
    while (newdisponiveis.length) {
        const [horarios, disponivel] = newdisponiveis.pop();
        const subdisponiveis = newdisponiveis.map(v => v[1]);
        const sub = [...caso, disponivel];
        valid.push([subdisponiveis, sub, constraints, horarios]);
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

    const creds = creditos(horarios);
    const buraco = hasBuraco(horarios, constraints);

    if (creds > cmax) return false;
    if (creds == cmax && buraco) return false;
    return true;
}

var state = {
    run: false,
    running: false,
    saved: [],
    callbacks: [],
    total: 0
};

(function loop() {
    setTimeout(() => {
        const newcasos = [];
        var last = performance.now();
        for (const saved of state.saved) {
            if (!state.run) break;
            state.running = true;
            const casos = stepcaso(...saved);
            state.total += casos.length;
            newcasos.push(casos);
            var now = performance.now();
            if (now - last > 200) {
                last = now;
                postMessage({total: state.total});
            }
        }
        if (state.run) {
            delete state.saved;
            state.saved = newcasos.flat();
            const solutions = [];
            for (const [, caso, constraints, horarios] of state.saved) {
                const {cmin} = constraints;
                const creds = creditos(horarios);
                const buraco = hasBuraco(horarios, constraints);
                if (creds >= cmin && !buraco) {
                    solutions.push([caso, creds]);
                }
            }

            if (!state.saved.length) {
                state.run = false;
                postMessage({done: true});
            } else if (solutions.length && state.run) {
                const step = 31415;
                for (var i = 0; i < solutions.length; i += step) {
                    postMessage({solutions: solutions.slice(i, i + step)});
                }
            }
        }
        if (!state.run) {
            state.total = 0;
            state.running = false;
        }
        loop();
    });
})();

function solve(ofertas, desejadas, constraints) {
    const disponiveis = [];
    const base = [...desejadas];
    for (const o of ofertas) {
        var found = false;
        for (const desejada of desejadas) {
            if (o.disciplina === desejada.disciplina) {
                found = true;
                break;
            }
        }
        if (!found) {
            disponiveis.push(o);
        }
    }

    state.saved = [[disponiveis, base, constraints, horariosDoCaso(base)]];
    state.run = true;
}

onmessage = function(e) {
    const d = e.data;
    if (d.run) {
        state.run = d.run;
    }

    if (d.solve) {
        if (state.running) {
            postMessage({running: true});
            return;
        }

        const {ofertas, desejadas, constraints} = d;
        solve(ofertas, desejadas, constraints);
    }
}
