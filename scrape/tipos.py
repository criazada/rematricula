from collections import namedtuple

Oferta = namedtuple('Oferta', ('cod', 'disc', 'nome', 'turma'))
Disciplina = namedtuple('Disciplina', ('disc', 'nome', 'ofertas'))
Descricao = namedtuple('Descricao', ('turma', 'curso', 'situacao', 'normal', 'especial', 'horarios'))
Horario = namedtuple('Horario', ('local', 'maximo', 'ocupacao', 'tipo', 'dia', 'hora'))
Local = namedtuple('Local', ('desc', 'abbr'))
Matricula = namedtuple('Matricula', ('oferecidas', 'ocupadas', 'restantes', 'pendentes', 'razao'))
Hora = namedtuple('Hora', ('inicio', 'fim'))
