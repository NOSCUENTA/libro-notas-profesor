'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────
const MIN_GRADE  = 2.0;
const MAX_GRADE  = 7.0;
const PASS_GRADE = 4.0;
const STORE_KEY  = 'libro_calificaciones_v3';

const DEFAULT_COURSES = [
  { id:'c1', name:'1° Básico A' }, { id:'c2', name:'2° Básico A' },
  { id:'c3', name:'3° Básico A' }, { id:'c4', name:'4° Básico A' },
  { id:'c5', name:'5° Básico A' }, { id:'c6', name:'6° Básico A' },
  { id:'c7', name:'7° Básico A' }, { id:'c8', name:'8° Básico A' },
];

const DEFAULT_SUBJECTS = [
  { id:'s1', name:'Historia y Geografía' },
  { id:'s2', name:'Orientación'          },
];

const COURSE_SUBJECTS = {
  c1: ['s1'],
  c2: ['s1'],
  c3: ['s1','s2'],
  c4: ['s1'],
  c5: ['s1'],
  c6: ['s1'],
  c7: ['s1'],
  c8: ['s1'],
};

// Asignaturas con calificación conceptual (no numérica)
const CONCEPTUAL_SUBJECTS = new Set(['s2']);
const CONCEPT_GRADES  = ['I', 'S', 'B', 'MB'];
const CONCEPT_LABELS  = { I:'Insuficiente', S:'Suficiente', B:'Bueno', MB:'Muy Bueno' };
const CONCEPT_TO_NUM  = { I:1, S:2, B:3, MB:4 };
function numToConcept(n) { return n < 1.5 ? 'I' : n < 2.5 ? 'S' : n < 3.5 ? 'B' : 'MB'; }

// Cursos con Taller JEC (bitácora de clases)
const TALLER_COURSES = new Set(['c3']);

const SAMPLE_STUDENTS = [
  'Álvarez Muñoz, Sofía',   'Bravo Contreras, Diego',  'Castro Rojas, Valentina',
  'Díaz Fuentes, Matías',   'Espinoza Silva, Camila',  'Flores Torres, Sebastián',
  'García Vega, Isadora',   'Herrera Castro, Tomás',   'Jiménez Araya, Catalina',
  'López Reyes, Nicolás',   'Morales Bravo, Martina',  'Núñez Pérez, Emilio',
];

// ── Default state factory ──────────────────────────────────────────────────────
function makeDefaultState() {
  const students    = {};
  const grades      = {};
  const evaluations = {};

  DEFAULT_COURSES.forEach(c => {
    students[c.id]    = SAMPLE_STUDENTS.map((name, i) => ({ id:`${c.id}_st${i}`, name }));
    grades[c.id]      = {};
    evaluations[c.id] = {};

    const subjIds = COURSE_SUBJECTS[c.id] || ['s1'];
    subjIds.forEach(sId => {
      const isConc    = CONCEPTUAL_SUBJECTS.has(sId);
      const baseEvals = isConc ? ['C1','C2','C3','C4'] : ['N1','N2','N3'];
      evaluations[c.id][sId] = { s1:[...baseEvals], s2:[...baseEvals] };
      grades[c.id][sId] = {};
      students[c.id].forEach(st => {
        grades[c.id][sId][st.id] = { s1:{}, s2:{} };
      });
    });
  });

  return {
    courses:      DEFAULT_COURSES.map(c => ({...c})),
    subjects:     DEFAULT_SUBJECTS.map(s => ({...s})),
    students,
    evaluations,
    grades,
    taller:       {},   // taller[courseId] = [{id, date, content, createdAt}]
    observations: {},   // observations[courseId] = {studentId: text}
    activeCourse:  'c1',
    activeSubject: 's1',
    view:          'grades',
    teacherName:   'Profesor/a de Historia',
    year:          new Date().getFullYear(),
  };
}

// ── App ────────────────────────────────────────────────────────────────────────
class GradeBook {
  constructor() {
    this.state = null;
    this._toastTimer = null;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        this.state = JSON.parse(raw);
        this._ensureIntegrity();
      } else {
        this.state = makeDefaultState();
      }
    } catch {
      this.state = makeDefaultState();
    }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch {}
  }

  _ensureIntegrity() {
    const s = this.state;
    s.subjects = DEFAULT_SUBJECTS.map(x => ({...x}));

    if (!s.students)    s.students    = {};
    if (!s.grades)      s.grades      = {};
    if (!s.evaluations) s.evaluations = {};

    DEFAULT_COURSES.forEach(c => {
      if (!s.students[c.id])    s.students[c.id]    = [];
      if (!s.grades[c.id])      s.grades[c.id]      = {};
      if (!s.evaluations[c.id]) s.evaluations[c.id] = {};

      const subjIds = COURSE_SUBJECTS[c.id] || ['s1'];
      subjIds.forEach(sId => {
        const isConc    = CONCEPTUAL_SUBJECTS.has(sId);
        const baseEvals = isConc ? ['C1','C2','C3','C4'] : ['N1','N2','N3'];
        if (!s.evaluations[c.id][sId])
          s.evaluations[c.id][sId] = { s1:[...baseEvals], s2:[...baseEvals] };
        if (!s.grades[c.id][sId])
          s.grades[c.id][sId] = {};
        s.students[c.id].forEach(st => {
          if (!s.grades[c.id][sId][st.id])
            s.grades[c.id][sId][st.id] = { s1:{}, s2:{} };
        });
      });
    });

    if (!s.taller)       s.taller       = {};
    if (!s.observations) s.observations = {};

    if (!s.activeCourse || !DEFAULT_COURSES.find(c => c.id === s.activeCourse))
      s.activeCourse = 'c1';

    // Subjects especiales (__taller__, __obs__) son válidos según el curso
    const validSubjs   = COURSE_SUBJECTS[s.activeCourse] || ['s1'];
    const specialValid = ['__obs__', ...(TALLER_COURSES.has(s.activeCourse) ? ['__taller__'] : [])];
    const isValidSubj  = validSubjs.includes(s.activeSubject) || specialValid.includes(s.activeSubject);
    if (!s.activeSubject || !isValidSubj)
      s.activeSubject = validSubjs[0];

    if (!s.teacherName) s.teacherName = 'Profesor/a de Historia';
    if (!s.year)        s.year        = new Date().getFullYear();
    if (!s.view)        s.view        = 'grades';
  }

  // ── Grade math ───────────────────────────────────────────────────────────────

  parseGrade(raw) {
    if (!raw || !raw.toString().trim()) return null;
    const str = raw.toString().replace(',', '.').trim();
    let v = parseFloat(str);
    if (isNaN(v)) return undefined;
    if (v > MAX_GRADE && v >= MIN_GRADE * 10 && v <= MAX_GRADE * 10) v = v / 10;
    v = Math.round(v * 10) / 10;
    if (v < MIN_GRADE || v > MAX_GRADE) return undefined;
    return v;
  }

  fmt(g) {
    if (g === null || g === undefined || g === '') return '—';
    if (typeof g === 'string') return g; // concepto: I, S, B, MB
    return g.toFixed(1);
  }

  fmtAvg(g) {
    if (g === null || g === undefined || g === '') return '—';
    if (typeof g === 'string') return g; // promedio conceptual
    const s = g.toFixed(2);
    return s.endsWith('0') ? s.slice(0, -1) : s;
  }

  gradeClass(g) {
    if (g === null || g === undefined || g === '') return 'g-empty';
    if (typeof g === 'string') {
      const map = { I:'g-fail', S:'g-low', B:'g-concept-b', MB:'g-good' };
      return map[g] || 'g-empty';
    }
    if (g < PASS_GRADE) return 'g-fail';
    if (g < 5.0)        return 'g-low';
    if (g < 6.0)        return 'g-mid';
    if (g < 7.0)        return 'g-good';
    return 'g-exc';
  }

  /** Promedio numérico exacto */
  avg(values) {
    const nums = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  /** Promedio conceptual: mapea a números, promedia, vuelve a concepto */
  conceptAvg(values) {
    const nums = values
      .filter(v => typeof v === 'string' && CONCEPT_TO_NUM[v] !== undefined)
      .map(v => CONCEPT_TO_NUM[v]);
    if (!nums.length) return null;
    return numToConcept(nums.reduce((a, b) => a + b, 0) / nums.length);
  }

  semAvg(cId, sId, stId, sem) {
    try {
      const evNames = this.state.evaluations[cId][sId][sem];
      const gmap    = this.state.grades[cId][sId][stId][sem] || {};
      const vals    = evNames.map(e => gmap[e] ?? null).filter(v => v !== null && v !== undefined && v !== '');
      if (!vals.length) return null;
      return CONCEPTUAL_SUBJECTS.has(sId)
        ? this.conceptAvg(vals)
        : this.avg(vals.filter(v => typeof v === 'number'));
    } catch { return null; }
  }

  finalAvg(cId, sId, stId) {
    const a1   = this.semAvg(cId, sId, stId, 's1');
    const a2   = this.semAvg(cId, sId, stId, 's2');
    const both = [a1, a2].filter(v => v !== null);
    if (!both.length) return null;
    return CONCEPTUAL_SUBJECTS.has(sId)
      ? this.conceptAvg(both.filter(v => typeof v === 'string'))
      : this.avg(both.filter(v => typeof v === 'number'));
  }

  // ── Render: full ─────────────────────────────────────────────────────────────

  render() {
    document.getElementById('app').innerHTML =
      `<aside class="sidebar">${this.renderSidebar()}</aside>` +
      `<main  class="main">${this.renderMain()}</main>`;
  }

  renderSidebar() {
    const { courses, subjects, activeCourse, activeSubject, teacherName, year } = this.state;

    const courseItems = courses.map(c => {
      const active   = c.id === activeCourse;
      const subjIds  = COURSE_SUBJECTS[c.id] || ['s1'];
      const subjList = subjects.filter(s => subjIds.includes(s.id));

      const tallerCount = (this.state.taller?.[c.id] || []).length;
      const obsEntries  = this.state.observations?.[c.id] || {};
      const obsCount    = Object.values(obsEntries).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
      const hasStudents = (this.state.students[c.id] || []).length > 0;

      const subList = active ? `
        <ul class="subject-list">
          ${subjList.map(s => `
            <li class="subject-item${s.id === activeSubject ? ' active' : ''}"
                data-action="set-subject" data-subject="${s.id}">
              <span class="subject-dot"></span>
              <span>${s.name}</span>
              ${CONCEPTUAL_SUBJECTS.has(s.id) ? '<span class="conc-badge">I·S·B·MB</span>' : ''}
            </li>`).join('')}
          ${TALLER_COURSES.has(c.id) ? `
            <li class="subject-item taller-sb-item${activeSubject === '__taller__' ? ' active' : ''}"
                data-action="set-subject" data-subject="__taller__">
              <span class="subject-dot taller-dot"></span>
              <span>Taller JEC</span>
              <span class="taller-sb-badge">${tallerCount > 0 ? tallerCount + (tallerCount === 1 ? ' clase' : ' clases') : 'Bitácora'}</span>
            </li>` : ''}
          ${hasStudents ? `
            <li class="subject-item obs-sb-item${activeSubject === '__obs__' ? ' active' : ''}"
                data-action="set-subject" data-subject="__obs__">
              <span class="subject-dot obs-dot"></span>
              <span>Observaciones</span>
              ${obsCount > 0 ? `<span class="obs-sb-badge">${obsCount}</span>` : ''}
            </li>` : ''}
        </ul>` : '';

      return `
        <li class="course-item${active ? ' active' : ''}">
          <div class="course-row" data-action="set-course" data-course="${c.id}">
            <span class="course-chevron">▶</span>
            <span class="course-name">${c.name}</span>
            <span class="course-badge">${(this.state.students[c.id]||[]).length}</span>
          </div>
          ${subList}
        </li>`;
    }).join('');

    return `
      <div class="sidebar-header">
        <div class="sb-logo">
          <div class="sb-logo-icon">📚</div>
          <div>
            <div class="sb-title">Libro de Notas</div>
            <div class="sb-year">${year}</div>
          </div>
        </div>
        <div class="sb-teacher" data-action="edit-teacher" title="Clic para editar nombre">${this._esc(teacherName)}</div>
      </div>

      <div class="sb-section">Cursos</div>
      <ul class="course-list">${courseItems}</ul>

      <div class="sb-footer">
        <div class="sb-footer-row">
          <button class="sb-btn${!this.state.view || this.state.view === 'overview' ? ' sb-btn-on' : ''}" data-action="show-overview">
            ${this._icon('grid')} Vista general
          </button>
          <button class="sb-btn" data-action="export-csv">
            ${this._icon('download')} Exportar
          </button>
        </div>
        <button class="sb-btn sb-btn-deudores${this.state.view === 'deudores' ? ' sb-btn-on' : ''}" data-action="show-deudores">
          ${this._icon('deudores')} Deudores de notas
        </button>
      </div>

      <div class="sb-school-brand">
        <img src="./logo-colegio.png" alt="Escuela José Miguel Martínez Soto" class="sb-school-logo"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="sb-school-fallback" style="display:none">
          <span class="sb-school-icon">🏫</span>
        </div>
        <div class="sb-school-info">
          <span class="sb-school-name">Escuela J.M. Martínez Soto</span>
          <span class="sb-school-place">Palguin Bajo</span>
        </div>
      </div>`;
  }

  renderMain() {
    if (this.state.view === 'deudores') return this.renderDeudores();
    const { activeCourse, activeSubject, courses, subjects } = this.state;
    if (!activeCourse || !activeSubject) return this.renderOverview();

    if (activeSubject === '__taller__') return this.renderTaller();
    if (activeSubject === '__obs__')    return this.renderObservaciones();

    const course  = courses.find(c => c.id === activeCourse);
    const subject = subjects.find(s => s.id === activeSubject);
    if (!course || !subject) return this.renderOverview();

    const isConc   = CONCEPTUAL_SUBJECTS.has(activeSubject);
    const students = this.state.students[activeCourse] || [];
    const evs      = this.state.evaluations[activeCourse][activeSubject];

    return `
      <div class="topbar">
        <div class="breadcrumb">
          <span class="bc-course">${this._esc(course.name)}</span>
          <span class="bc-sep">›</span>
          <span class="bc-subject">${this._esc(subject.name)}</span>
          ${isConc ? '<span class="bc-conc-tag">Conceptual</span>' : ''}
        </div>
        <div class="topbar-actions">
          <button class="btn-add" data-action="add-student">
            ${this._icon('add-person')} Agregar alumno
          </button>
        </div>
      </div>

      <div class="table-wrap">
        <table class="grade-table${isConc ? ' conc-table' : ''}" id="grade-table">
          ${this.renderThead(evs, isConc)}
          <tbody id="grade-tbody">
            ${students.length
              ? students.map((st, i) => this.renderRow(st, i)).join('')
              : `<tr class="empty-row"><td colspan="100">
                   Sin alumnos. Haz clic en "Agregar alumno" para comenzar.
                 </td></tr>`}
          </tbody>
          ${students.length ? `<tfoot>${this.renderStatsRow(students, evs)}</tfoot>` : ''}
        </table>
      </div>

      ${students.length ? this.renderStatsPanel(students) : ''}`;
  }

  renderThead(evs, isConc) {
    const s1Cols = evs.s1.length + 2;
    const s2Cols = evs.s2.length + 2;

    const mkHeaders = (sem) => evs[sem].map((e, i) => `
      <th class="th-eval${isConc ? ' th-conc' : ''}" data-sem="${sem}" data-idx="${i}" title="Doble clic para renombrar">
        <div class="eval-inner">
          <span>${this._esc(e)}</span>
          <button class="eval-del" data-action="del-eval" data-sem="${sem}" data-idx="${i}" title="Eliminar">×</button>
        </div>
      </th>`).join('');

    const s2BorderClass = isConc ? ' s2-left-border' : ' s2-left-border';

    return `
      <thead>
        <tr>
          <th class="th-num" rowspan="2">#</th>
          <th class="th-name" rowspan="2">Nombre del Alumno</th>
          <th colspan="${s1Cols}" class="th-sem">1er Semestre</th>
          <th colspan="${s2Cols}" class="th-sem th-sem-s2">2do Semestre</th>
          <th class="th-final" rowspan="2">${isConc ? 'Concepto<br>Final' : 'Promedio<br>Final'}</th>
        </tr>
        <tr>
          ${mkHeaders('s1')}
          <th class="th-avg">${isConc ? 'Conc S1' : 'Prom S1'}</th>
          <th class="th-add" data-action="add-eval" data-sem="s1" title="Agregar evaluación">＋</th>

          ${mkHeaders('s2')}
          <th class="th-avg${s2BorderClass}">${isConc ? 'Conc S2' : 'Prom S2'}</th>
          <th class="th-add" data-action="add-eval" data-sem="s2" title="Agregar evaluación">＋</th>
        </tr>
      </thead>`;
  }

  renderRow(st, idx) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const gmap  = this.state.grades[cId][sId][st.id] || { s1:{}, s2:{} };
    const evs   = this.state.evaluations[cId][sId];
    const isConc = CONCEPTUAL_SUBJECTS.has(sId);

    const s1Avg = this.semAvg(cId, sId, st.id, 's1');
    const s2Avg = this.semAvg(cId, sId, st.id, 's2');
    const final = this.finalAvg(cId, sId, st.id);

    const mkCells = (sem) => evs[sem].map((e, i) => {
      const g      = gmap[sem]?.[e] ?? null;
      const border = (sem === 's2' && i === 0) ? ' s2-left-border' : '';
      return `<td class="grade-cell ${this.gradeClass(g)}${border}${isConc ? ' conc-cell' : ''}"
                  data-action="edit-grade"
                  data-student="${st.id}" data-sem="${sem}" data-eval="${e}">
                <span class="grade-val">${this.fmt(g)}</span>
              </td>`;
    }).join('');

    const statusLabel = final !== null
      ? isConc
        ? `<span class="final-status conc-badge-final ${this.gradeClass(final)}">${final}</span>`
        : `<span class="final-status ${final >= PASS_GRADE ? 'pass' : 'fail'}">${final >= PASS_GRADE ? 'APRO' : 'REPR'}</span>`
      : '';

    return `
      <tr class="student-row" data-student="${st.id}">
        <td class="td-num">${idx + 1}</td>
        <td class="td-name">
          <div class="student-name-wrap">
            <span class="student-name" title="${this._esc(st.name)}">${this._esc(st.name)}</span>
            <button class="del-student-btn" data-action="del-student" data-student="${st.id}" title="Eliminar alumno">×</button>
          </div>
        </td>
        ${mkCells('s1')}
        <td class="td-avg ${this.gradeClass(s1Avg)}">${this.fmtAvg(s1Avg)}</td>
        <td class="td-spacer"></td>
        ${mkCells('s2')}
        <td class="td-avg ${this.gradeClass(s2Avg)} s2-left-border">${this.fmtAvg(s2Avg)}</td>
        <td class="td-spacer"></td>
        <td class="td-final ${this.gradeClass(final)}">
          <div class="final-inner">
            <strong>${this.fmtAvg(final)}</strong>${statusLabel}
          </div>
        </td>
      </tr>`;
  }

  renderStatsRow(students, evs) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const isConc = CONCEPTUAL_SUBJECTS.has(sId);

    const evalAvg = (sem, e) => {
      const vals = students
        .map(st => this.state.grades[cId][sId][st.id]?.[sem]?.[e] ?? null)
        .filter(v => v !== null && v !== '');
      return isConc ? this.conceptAvg(vals) : this.avg(vals);
    };

    const s1Cells = evs.s1.map(e => {
      const a = evalAvg('s1', e);
      return `<td class="td-stat-val ${this.gradeClass(a)}">${this.fmtAvg(a)}</td>`;
    }).join('');

    const s2Cells = evs.s2.map((e, i) => {
      const a      = evalAvg('s2', e);
      const border = i === 0 ? ' s2-left-border' : '';
      return `<td class="td-stat-val ${this.gradeClass(a)}${border}">${this.fmtAvg(a)}</td>`;
    }).join('');

    const s1Avgs = students.map(st => this.semAvg(cId, sId, st.id, 's1')).filter(v => v !== null);
    const s2Avgs = students.map(st => this.semAvg(cId, sId, st.id, 's2')).filter(v => v !== null);
    const finals = students.map(st => this.finalAvg(cId, sId, st.id)).filter(v => v !== null);
    const cs1 = isConc ? this.conceptAvg(s1Avgs) : this.avg(s1Avgs);
    const cs2 = isConc ? this.conceptAvg(s2Avgs) : this.avg(s2Avgs);
    const cf  = isConc ? this.conceptAvg(finals)  : this.avg(finals);

    return `
      <tr>
        <td class="td-stats-num"></td>
        <td class="td-stats-label">${isConc ? 'Concepto promedio' : 'Promedio del curso'}</td>
        ${s1Cells}
        <td class="td-stat-val ${this.gradeClass(cs1)}" style="font-weight:700">${this.fmtAvg(cs1)}</td>
        <td></td>
        ${s2Cells}
        <td class="td-stat-val ${this.gradeClass(cs2)} s2-left-border" style="font-weight:700">${this.fmtAvg(cs2)}</td>
        <td></td>
        <td class="td-stat-val ${this.gradeClass(cf)}" style="font-weight:700;font-size:0.88rem">${this.fmtAvg(cf)}</td>
      </tr>`;
  }

  renderStatsPanel(students) {
    const { activeCourse: cId, activeSubject: sId } = this.state;

    if (CONCEPTUAL_SUBJECTS.has(sId)) {
      // Panel de distribución conceptual
      const finals = students.map(st => this.finalAvg(cId, sId, st.id)).filter(v => v !== null);
      const total  = finals.length || 1;
      const counts = { I:0, S:0, B:0, MB:0 };
      finals.forEach(v => { if (counts[v] !== undefined) counts[v]++; });

      return `
        <div class="stats-panel">
          ${CONCEPT_GRADES.map(c => {
            const pct = Math.round(counts[c] / total * 100);
            return `
              <div class="stat-card">
                <div class="stat-num ${this.gradeClass(c)}" style="font-size:1.8rem;font-family:var(--ff-mono)">${counts[c]}</div>
                <div class="stat-label">${CONCEPT_LABELS[c]}</div>
                <div class="stat-pct-bar"><div class="stat-pct-fill conc-bar-${c.toLowerCase()}" style="width:${pct}%"></div></div>
                <div class="stat-sub">${pct}% · ${counts[c]} alumno${counts[c] !== 1 ? 's' : ''}</div>
              </div>`;
          }).join('')}
        </div>`;
    }

    // Panel numérico
    const finals   = students.map(st => this.finalAvg(cId, sId, st.id)).filter(v => v !== null);
    const passed   = finals.filter(v => v >= PASS_GRADE).length;
    const failed   = finals.filter(v => v <  PASS_GRADE).length;
    const classAvg = this.avg(finals);
    const highest  = finals.length ? Math.max(...finals) : null;
    const lowest   = finals.length ? Math.min(...finals) : null;
    const pPassed  = finals.length ? Math.round(passed / finals.length * 100) : 0;
    const pFailed  = finals.length ? Math.round(failed / finals.length * 100) : 0;

    return `
      <div class="stats-panel">
        <div class="stat-card stat-passed">
          <div class="stat-num">${passed}</div>
          <div class="stat-label">Aprobados</div>
          <div class="stat-pct-bar"><div class="stat-pct-fill" style="width:${pPassed}%"></div></div>
          <div class="stat-sub">${pPassed}% del curso</div>
        </div>
        <div class="stat-card stat-failed">
          <div class="stat-num">${failed}</div>
          <div class="stat-label">Reprobados</div>
          <div class="stat-pct-bar"><div class="stat-pct-fill" style="width:${pFailed}%"></div></div>
          <div class="stat-sub">${pFailed}% del curso</div>
        </div>
        <div class="stat-card stat-avg">
          <div class="stat-num ${this.gradeClass(classAvg)}" style="font-family:var(--ff-display)">${this.fmtAvg(classAvg)}</div>
          <div class="stat-label">Promedio Final</div>
          <div class="stat-sub">Exacto, sin redondeo</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="font-size:1.5rem;letter-spacing:-0.02em">
            <span class="${this.gradeClass(highest)}">${this.fmtAvg(highest)}</span>
            <span style="color:var(--ink-4);font-size:1rem;margin:0 4px">/</span>
            <span class="${this.gradeClass(lowest)}">${this.fmtAvg(lowest)}</span>
          </div>
          <div class="stat-label">Máxima / Mínima</div>
          <div class="stat-sub">Notas extremas del curso</div>
        </div>
      </div>`;
  }

  renderOverview() {
    const { courses, subjects } = this.state;

    const cards = courses.map(c => {
      const students = this.state.students[c.id] || [];
      const sId      = COURSE_SUBJECTS[c.id]?.[0] || 's1';
      const isConc   = CONCEPTUAL_SUBJECTS.has(sId);
      const finals   = students.map(st => this.finalAvg(c.id, sId, st.id)).filter(v => v !== null);
      const subjNames = (COURSE_SUBJECTS[c.id] || ['s1'])
        .map(id => subjects.find(s => s.id === id)?.name || '')
        .join(' · ');

      let avgDisplay, passed, pct;
      if (isConc) {
        const counts = { I:0, S:0, B:0, MB:0 };
        finals.forEach(v => { if (counts[v] !== undefined) counts[v]++; });
        passed = (counts.S + counts.B + counts.MB);
        pct    = finals.length ? Math.round(passed / finals.length * 100) : 0;
        const topConcept = this.conceptAvg(finals);
        avgDisplay = `<div class="ov-avg ${this.gradeClass(topConcept)}" style="font-size:1.5rem">${topConcept || '—'}</div>`;
      } else {
        const classAvg = this.avg(finals);
        passed = finals.filter(v => v >= PASS_GRADE).length;
        pct    = finals.length ? Math.round(passed / finals.length * 100) : 0;
        avgDisplay = `<div class="ov-avg ${this.gradeClass(classAvg)}">${this.fmtAvg(classAvg)}</div>`;
      }

      return `
        <div class="overview-card" data-action="set-course" data-course="${c.id}">
          <div class="ov-course">${this._esc(c.name)}</div>
          <div class="ov-count">${students.length} alumno${students.length !== 1 ? 's' : ''} · ${subjNames}</div>
          ${avgDisplay}
          <div class="ov-bar"><div class="ov-bar-fill" style="width:${pct}%"></div></div>
          <div class="ov-stats">${passed} aprobados · ${pct}%</div>
        </div>`;
    }).join('');

    return `
      <div class="topbar">
        <div class="breadcrumb"><span class="bc-overview">Vista General — Todos los cursos</span></div>
      </div>
      <div class="overview-grid">${cards}</div>`;
  }

  // ── Partial DOM refresh ──────────────────────────────────────────────────────

  refreshRow(studentId) {
    const row = document.querySelector(`tr.student-row[data-student="${studentId}"]`);
    if (!row) return;
    const { activeCourse: cId } = this.state;
    const students = this.state.students[cId];
    const idx = students.findIndex(s => s.id === studentId);
    if (idx === -1) return;
    const t = document.createElement('template');
    t.innerHTML = this.renderRow(students[idx], idx);
    row.replaceWith(t.content.firstElementChild);
  }

  refreshStats() {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const students = this.state.students[cId] || [];
    const evs      = this.state.evaluations[cId][sId];

    const tfoot = document.querySelector('tfoot');
    if (tfoot) {
      const t = document.createElement('template');
      t.innerHTML = `<tfoot>${this.renderStatsRow(students, evs)}</tfoot>`;
      tfoot.replaceWith(t.content.firstElementChild);
    }
    const panel = document.querySelector('.stats-panel');
    if (panel && students.length) {
      const t = document.createElement('template');
      t.innerHTML = this.renderStatsPanel(students);
      panel.replaceWith(t.content.firstElementChild);
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  _bindAll() {
    const app = document.getElementById('app');
    app.addEventListener('click',    e => this._onClick(e));
    app.addEventListener('dblclick', e => this._onDblClick(e));
    app.addEventListener('input',    e => this._onInput(e));
  }

  _onInput(e) {
    const el     = e.target;
    const action = el.dataset?.action;
    if (!action) return;
    const cId = this.state.activeCourse;

    if (action === 'taller-text') {
      const id  = el.dataset.id;
      const arr = this.state.taller[cId];
      if (!arr) return;
      const entry = arr.find(x => x.id === id);
      if (entry) { entry.content = el.value; this.save(); }

    } else if (action === 'taller-date') {
      const id  = el.dataset.id;
      const arr = this.state.taller[cId];
      if (!arr) return;
      const entry = arr.find(x => x.id === id);
      if (entry) {
        entry.date = el.value;
        this.save();
        const lbl = el.closest('.taller-entry-header')?.querySelector('.taller-entry-date-label');
        if (lbl) lbl.textContent = this._fmtDateES(el.value);
      }

    } else if (action === 'obs-text') {
      const stId    = el.dataset.student;
      const entryId = el.dataset.id;
      if (!this.state.observations[cId])         this.state.observations[cId]       = {};
      if (!this.state.observations[cId][stId])   this.state.observations[cId][stId] = [];
      const entry = this.state.observations[cId][stId].find(x => x.id === entryId);
      if (entry) { entry.content = el.value; this.save(); }

    } else if (action === 'obs-date') {
      const stId    = el.dataset.student;
      const entryId = el.dataset.id;
      if (!this.state.observations[cId]?.[stId]) return;
      const entry = this.state.observations[cId][stId].find(x => x.id === entryId);
      if (entry) {
        entry.date = el.value;
        this.save();
        const lbl = el.closest('.obs-entry-header')?.querySelector('.obs-entry-date-label');
        if (lbl) lbl.textContent = this._fmtDateES(el.value);
      }
    }
  }

  _onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    e.stopPropagation();
    const a = el.dataset.action;

    if (a === 'set-course') {
      const cId = el.dataset.course;
      this.state.activeCourse  = cId;
      const validSubjs = COURSE_SUBJECTS[cId] || ['s1'];
      this.state.activeSubject = validSubjs[0];
      this.state.view = 'grades';
      this.save(); this.render();

    } else if (a === 'set-subject') {
      this.state.activeSubject = el.dataset.subject;
      this.state.view = 'grades';
      this.save(); this.render();

    } else if (a === 'edit-grade') {
      this._startEdit(el);

    } else if (a === 'add-student') {
      this._promptAddStudent();

    } else if (a === 'del-student') {
      this._confirmDeleteStudent(el.dataset.student);

    } else if (a === 'add-eval') {
      this._promptAddEval(el.dataset.sem);

    } else if (a === 'del-eval') {
      this._confirmDeleteEval(el.dataset.sem, parseInt(el.dataset.idx));

    } else if (a === 'edit-teacher') {
      this._promptEditTeacher();

    } else if (a === 'show-overview') {
      this.state.activeCourse  = null;
      this.state.activeSubject = null;
      this.state.view = 'overview';
      this.render();

    } else if (a === 'show-deudores') {
      this.state.view = 'deudores';
      this.save(); this.render();


    } else if (a === 'export-csv') {
      this._exportCSV();

    } else if (a === 'export-deudores') {
      this._exportDeudoresCSV();

    } else if (a === 'add-taller-entry') {
      const cId   = this.state.activeCourse;
      if (!this.state.taller[cId]) this.state.taller[cId] = [];
      const today = new Date().toISOString().slice(0, 10);
      const id    = `t_${Date.now()}`;
      this.state.taller[cId].unshift({ id, date: today, content: '', createdAt: Date.now() });
      this.save(); this.render();
      requestAnimationFrame(() => {
        const ta = document.querySelector(`textarea[data-action="taller-text"][data-id="${id}"]`);
        if (ta) ta.focus();
      });

    } else if (a === 'del-taller-entry') {
      const cId = this.state.activeCourse;
      const id  = el.dataset.id;
      this.showModal({
        title: 'Eliminar entrada',
        body: `<p class="confirm-message">¿Eliminar esta entrada del Taller JEC? Esta acción no se puede deshacer.</p>`,
        confirm: 'Eliminar', confirmDanger: true,
        onConfirm: () => {
          this.state.taller[cId] = (this.state.taller[cId] || []).filter(x => x.id !== id);
          this.save(); this.hideModal(); this.render();
        }
      });

    } else if (a === 'export-taller') {
      this._exportTallerCSV();

    } else if (a === 'toggle-obs-student') {
      const block = el.closest('.obs-student-block');
      if (block) block.classList.toggle('obs-open');

    } else if (a === 'add-obs-entry') {
      const cId  = this.state.activeCourse;
      const stId = el.dataset.student;
      if (!this.state.observations[cId])        this.state.observations[cId]       = {};
      if (!this.state.observations[cId][stId])  this.state.observations[cId][stId] = [];
      const today = new Date().toISOString().slice(0, 10);
      const id    = `o_${Date.now()}`;
      this.state.observations[cId][stId].unshift({ id, date: today, content: '', createdAt: Date.now() });
      this.save(); this.render();
      requestAnimationFrame(() => {
        // Auto-expandir el bloque del alumno correspondiente
        const block = document.querySelector(`.obs-student-block[data-student-block="${stId}"]`);
        if (block) block.classList.add('obs-open');
        const ta = document.querySelector(`textarea[data-action="obs-text"][data-id="${id}"]`);
        if (ta) ta.focus();
      });

    } else if (a === 'del-obs-entry') {
      const cId     = this.state.activeCourse;
      const stId    = el.dataset.student;
      const entryId = el.dataset.id;
      this.showModal({
        title: 'Eliminar observación',
        body: `<p class="confirm-message">¿Eliminar esta observación? Esta acción no se puede deshacer.</p>`,
        confirm: 'Eliminar', confirmDanger: true,
        onConfirm: () => {
          if (this.state.observations[cId]?.[stId])
            this.state.observations[cId][stId] = this.state.observations[cId][stId].filter(x => x.id !== entryId);
          this.save(); this.hideModal(); this.render();
          requestAnimationFrame(() => {
            const block = document.querySelector(`.obs-student-block[data-student-block="${stId}"]`);
            if (block) block.classList.add('obs-open');
          });
        }
      });

    } else if (a === 'export-obs') {
      this._exportObsCSV();
    }
  }

  _onDblClick(e) {
    const th = e.target.closest('th.th-eval');
    if (!th) return;
    this._promptRenameEval(th.dataset.sem, parseInt(th.dataset.idx));
  }

  // ── Inline grade editing ─────────────────────────────────────────────────────

  _startEdit(cell) {
    const existing = document.querySelector('.grade-input, .concept-select');
    if (existing) existing.blur();

    const studentId = cell.dataset.student;
    const sem       = cell.dataset.sem;
    const evalName  = cell.dataset.eval;
    const { activeCourse: cId, activeSubject: sId } = this.state;

    if (CONCEPTUAL_SUBJECTS.has(sId)) {
      this._startConceptEdit(cell, studentId, sem, evalName, cId, sId);
      return;
    }

    const current = this.state.grades[cId][sId][studentId]?.[sem]?.[evalName] ?? null;

    cell.classList.add('editing');
    const span = cell.querySelector('.grade-val');
    span.style.visibility = 'hidden';

    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = 'grade-input';
    input.value       = current !== null ? current.toString().replace('.', ',') : '';
    input.placeholder = '—';
    input.maxLength   = 4;
    cell.appendChild(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = () => {
      if (committed) return true;
      const raw = input.value.trim();
      let newGrade;

      if (!raw || raw === '-' || raw === '—') {
        newGrade = null;
      } else {
        newGrade = this.parseGrade(raw);
        if (newGrade === undefined) {
          cell.classList.add('invalid');
          setTimeout(() => cell.classList.remove('invalid'), 500);
          input.focus(); input.select();
          return false;
        }
      }

      committed = true;
      if (!this.state.grades[cId][sId][studentId])
        this.state.grades[cId][sId][studentId] = { s1:{}, s2:{} };
      this.state.grades[cId][sId][studentId][sem][evalName] = newGrade;
      this.save();

      cell.classList.remove('editing');
      span.style.visibility = '';
      input.remove();
      this.refreshRow(studentId);
      this.refreshStats();
      return true;
    };

    input.addEventListener('blur', () => commit());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (commit()) this._focusAdjacent(studentId, sem, evalName, 1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (commit()) this._focusAdjacent(studentId, sem, evalName, e.shiftKey ? -1 : 1, 0);
      } else if (e.key === 'Escape') {
        committed = true;
        cell.classList.remove('editing');
        span.style.visibility = '';
        input.remove();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (commit()) this._focusAdjacent(studentId, sem, evalName, 0, 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commit()) this._focusAdjacent(studentId, sem, evalName, 0, -1);
      }
    });
  }

  _startConceptEdit(cell, studentId, sem, evalName, cId, sId) {
    // Cerrar cualquier picker abierto
    document.querySelectorAll('.concept-picker').forEach(p => p.remove());

    const current = this.state.grades[cId][sId][studentId]?.[sem]?.[evalName] ?? null;

    const save = (val) => {
      picker.remove();
      document.removeEventListener('mousedown', outsideClick, true);
      if (!this.state.grades[cId][sId][studentId])
        this.state.grades[cId][sId][studentId] = { s1:{}, s2:{} };
      this.state.grades[cId][sId][studentId][sem][evalName] = val;
      this.save();
      this.refreshRow(studentId);
      this.refreshStats();
    };

    const picker = document.createElement('div');
    picker.className = 'concept-picker';
    picker.setAttribute('role', 'listbox');

    // Botón borrar
    const clearBtn = document.createElement('button');
    clearBtn.className   = `cp-btn cp-clear${!current ? ' cp-active' : ''}`;
    clearBtn.textContent = '—';
    clearBtn.title       = 'Borrar calificación';
    clearBtn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); save(null); });
    picker.appendChild(clearBtn);

    CONCEPT_GRADES.forEach(c => {
      const btn = document.createElement('button');
      btn.className   = `cp-btn cp-${c.toLowerCase()}${c === current ? ' cp-active' : ''}`;
      btn.textContent = c;
      btn.title       = CONCEPT_LABELS[c];
      btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); save(c); });
      picker.appendChild(btn);
    });

    // Posicionar debajo o arriba de la celda
    const rect       = cell.getBoundingClientRect();
    const pickerH    = 42;
    const pickerW    = 210;
    const top        = (window.innerHeight - rect.bottom > pickerH + 8)
      ? rect.bottom + 3
      : rect.top - pickerH - 3;
    const left       = Math.min(rect.left, window.innerWidth - pickerW - 8);
    picker.style.cssText = `position:fixed;top:${top}px;left:${Math.max(4, left)}px`;

    document.body.appendChild(picker);

    // Cerrar al hacer click fuera
    const outsideClick = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('mousedown', outsideClick, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 0);
  }

  _allCells() {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const students = this.state.students[cId] || [];
    const evs      = this.state.evaluations[cId][sId];
    const cells    = [];
    students.forEach(st => {
      evs.s1.forEach(e => cells.push({ stId:st.id, sem:'s1', eval:e }));
      evs.s2.forEach(e => cells.push({ stId:st.id, sem:'s2', eval:e }));
    });
    return cells;
  }

  _focusAdjacent(studentId, sem, evalName, dCol, dRow) {
    const cells      = this._allCells();
    const evs        = this.state.evaluations[this.state.activeCourse][this.state.activeSubject];
    const colsPerRow = evs.s1.length + evs.s2.length;
    const idx        = cells.findIndex(c => c.stId === studentId && c.sem === sem && c.eval === evalName);
    if (idx === -1) return;
    const next = cells[idx + dCol + dRow * colsPerRow];
    if (!next) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `td.grade-cell[data-student="${next.stId}"][data-sem="${next.sem}"][data-eval="${next.eval}"]`
      );
      if (el) el.click();
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  _promptAddStudent() {
    this.showModal({
      title: 'Agregar Alumno',
      body: `
        <label class="modal-label">Nombre completo</label>
        <input type="text" id="m-input" class="modal-input" placeholder="Apellido Apellido, Nombre" autofocus>
        <div class="modal-hint">Formato sugerido: <em>Apellido Apellido, Nombre</em></div>`,
      confirm: 'Agregar',
      onConfirm: () => {
        const name = document.getElementById('m-input').value.trim();
        if (!name) return;
        this._addStudent(name);
        this.hideModal();
      }
    });
  }

  _addStudent(name) {
    const { activeCourse: cId, subjects } = this.state;
    const id = `${cId}_st_${Date.now()}`;
    this.state.students[cId].push({ id, name });
    subjects.forEach(s => {
      if (!this.state.grades[cId][s.id]) this.state.grades[cId][s.id] = {};
      this.state.grades[cId][s.id][id] = { s1:{}, s2:{} };
    });
    this.save(); this.render();
    this.toast(`Alumno "${name}" agregado`);
  }

  _confirmDeleteStudent(studentId) {
    const { activeCourse: cId } = this.state;
    const st = this.state.students[cId]?.find(s => s.id === studentId);
    if (!st) return;
    this.showModal({
      title: 'Eliminar alumno',
      body: `<p class="confirm-message">¿Eliminar a <strong>${this._esc(st.name)}</strong>? Se perderán todas sus calificaciones.</p>`,
      confirm: 'Eliminar', confirmDanger: true,
      onConfirm: () => {
        this.state.students[cId] = this.state.students[cId].filter(s => s.id !== studentId);
        this.state.subjects.forEach(s => {
          if (this.state.grades[cId]?.[s.id]?.[studentId] !== undefined)
            delete this.state.grades[cId][s.id][studentId];
        });
        this.save(); this.hideModal(); this.render();
        this.toast('Alumno eliminado');
      }
    });
  }

  _promptAddEval(sem) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const isConc  = CONCEPTUAL_SUBJECTS.has(sId);
    const current = this.state.evaluations[cId][sId][sem];
    const prefix  = isConc ? 'C' : 'N';
    const suggested = `${prefix}${current.length + 1}`;

    this.showModal({
      title: `Nueva evaluación — ${sem === 's1' ? '1er' : '2do'} Semestre`,
      body: `
        <label class="modal-label">Nombre de la evaluación</label>
        <input type="text" id="m-input" class="modal-input" value="${suggested}" autofocus>
        <div class="modal-hint">${isConc
          ? 'La calificación se ingresará como I / S / B / MB.'
          : 'Ej: N6, Prueba, Trabajo, Disertación'}</div>`,
      confirm: 'Agregar',
      onConfirm: () => {
        const name = document.getElementById('m-input').value.trim();
        if (!name) return;
        this._addEval(sem, name);
        this.hideModal();
      }
    });
  }

  _addEval(sem, name) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    this.state.evaluations[cId][sId][sem].push(name);
    this.save(); this.render();
  }

  _confirmDeleteEval(sem, idx) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const evs = this.state.evaluations[cId][sId][sem];
    if (evs.length <= 1) { this.toast('Debe haber al menos una evaluación por semestre', 'warn'); return; }
    const evalName = evs[idx];
    this.showModal({
      title: 'Eliminar evaluación',
      body: `<p class="confirm-message">¿Eliminar la evaluación <strong>${this._esc(evalName)}</strong>? Se perderán todas las notas de esta columna.</p>`,
      confirm: 'Eliminar', confirmDanger: true,
      onConfirm: () => {
        this.state.evaluations[cId][sId][sem].splice(idx, 1);
        (this.state.students[cId] || []).forEach(st => {
          delete this.state.grades[cId][sId]?.[st.id]?.[sem]?.[evalName];
        });
        this.save(); this.hideModal(); this.render();
      }
    });
  }

  _promptRenameEval(sem, idx) {
    const { activeCourse: cId, activeSubject: sId } = this.state;
    const oldName = this.state.evaluations[cId][sId][sem][idx];
    this.showModal({
      title: 'Renombrar evaluación',
      body: `
        <label class="modal-label">Nuevo nombre</label>
        <input type="text" id="m-input" class="modal-input" value="${this._esc(oldName)}" autofocus>`,
      confirm: 'Guardar',
      onConfirm: () => {
        const newName = document.getElementById('m-input').value.trim();
        if (!newName || newName === oldName) { this.hideModal(); return; }
        this.state.evaluations[cId][sId][sem][idx] = newName;
        (this.state.students[cId] || []).forEach(st => {
          const sg = this.state.grades[cId][sId]?.[st.id]?.[sem];
          if (sg && oldName in sg) { sg[newName] = sg[oldName]; delete sg[oldName]; }
        });
        this.save(); this.hideModal(); this.render();
      }
    });
  }

  _promptEditTeacher() {
    this.showModal({
      title: 'Nombre del docente',
      body: `<input type="text" id="m-input" class="modal-input" value="${this._esc(this.state.teacherName)}" autofocus>`,
      confirm: 'Guardar',
      onConfirm: () => {
        const name = document.getElementById('m-input').value.trim();
        if (!name) { this.hideModal(); return; }
        this.state.teacherName = name;
        this.save(); this.hideModal(); this.render();
      }
    });
  }

  _exportCSV() {
    const { activeCourse: cId, activeSubject: sId, courses, subjects } = this.state;
    if (!cId || !sId) { this.toast('Selecciona un curso y materia', 'warn'); return; }

    const course   = courses.find(c => c.id === cId);
    const subject  = subjects.find(s => s.id === sId);
    const students = this.state.students[cId] || [];
    const evs      = this.state.evaluations[cId][sId];
    const isConc   = CONCEPTUAL_SUBJECTS.has(sId);

    const esc = v => `"${String(v).replace(/"/g,'""')}"`;
    const header = [
      'Alumno',
      ...evs.s1.map(e => `S1: ${e}`), isConc ? 'Conc S1' : 'Prom S1',
      ...evs.s2.map(e => `S2: ${e}`), isConc ? 'Conc S2' : 'Prom S2',
      isConc ? 'Final' : 'Final'
    ].map(esc).join(',');

    const rows = students.map(st => {
      const s1g = evs.s1.map(e => this.state.grades[cId][sId][st.id]?.s1?.[e] ?? '');
      const s2g = evs.s2.map(e => this.state.grades[cId][sId][st.id]?.s2?.[e] ?? '');
      return [
        esc(st.name),
        ...s1g, this.fmtAvg(this.semAvg(cId, sId, st.id, 's1')),
        ...s2g, this.fmtAvg(this.semAvg(cId, sId, st.id, 's2')),
        this.fmtAvg(this.finalAvg(cId, sId, st.id)),
      ].join(',');
    });

    const blob = new Blob([`﻿${header}\n${rows.join('\n')}`], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `Notas_${course.name}_${subject.name}_${this.state.year}.csv`.replace(/[\\/:*?"<>|]/g,'_'),
    });
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Exportado como CSV ✓');
  }

  // ── Modal ────────────────────────────────────────────────────────────────────

  showModal({ title, body, confirm, confirmDanger, onConfirm }) {
    const backdrop = document.getElementById('modal-backdrop');
    const modal    = document.getElementById('modal');

    modal.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" id="m-close">×</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">
        <button class="btn-modal-cancel" id="m-cancel">Cancelar</button>
        <button class="btn-modal-confirm${confirmDanger ? ' danger' : ''}" id="m-confirm">${confirm}</button>
      </div>`;

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');

    setTimeout(() => {
      const inp = modal.querySelector('input');
      if (inp) { inp.focus(); inp.select(); }
    }, 60);

    const close = () => this.hideModal();
    document.getElementById('m-close').onclick   = close;
    document.getElementById('m-cancel').onclick  = close;
    document.getElementById('m-confirm').onclick = onConfirm;
    backdrop.onclick = close;
    modal.onkeydown  = e => {
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') close();
    };
  }

  hideModal() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal').classList.add('hidden');
  }

  // ── Toast ────────────────────────────────────────────────────────────────────

  toast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast${type === 'warn' ? ' warn' : ''} show`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  _icon(name) {
    const icons = {
      'grid':       `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="0.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/><rect x="7.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/><rect x="0.5" y="7.5" width="5" height="5" rx="1" fill="currentColor" opacity=".7"/><rect x="7.5" y="7.5" width="5" height="5" rx="1" fill="currentColor"/></svg>`,
      'download':   `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v7M4 6l2.5 2.5L9 6M1 10v.5A1.5 1.5 0 002.5 12h8A1.5 1.5 0 0012 10.5V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      'add-person': `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 12c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="11" y1="1.5" x2="11" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="3.5" x2="13" y2="3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      'deudores':   `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="4" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M1 12c0-3 2.5-5 5.5-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="10.5" r="2" stroke="currentColor" stroke-width="1.4"/><line x1="10.5" y1="9.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="10.5" cy="11.5" r="0.3" fill="currentColor"/></svg>`,
    };
    return icons[name] || '';
  }

  // ── Deudores ─────────────────────────────────────────────────────────────────

  /**
   * Lógica: una evaluación se considera "activa" (requerida) para un alumno
   * sólo si AL MENOS UN OTRO alumno del mismo curso ya tiene nota en esa columna.
   * Así, si nadie tiene N3 todavía, N3 no cuenta como deuda de nadie.
   * Cuando el profesor empieza a ingresar N3 para algunos, los que no la tienen
   * aparecen automáticamente como deudores.
   */
  _getDeudores() {
    const result = [];

    DEFAULT_COURSES.forEach(c => {
      const students = this.state.students[c.id] || [];
      if (!students.length) return;
      const subjIds = COURSE_SUBJECTS[c.id] || ['s1'];

      // Determinar qué columnas están "activas" (al menos 1 alumno con nota)
      const active = {}; // active[sId][sem] = Set<evalName>
      subjIds.forEach(sId => {
        active[sId] = { s1: new Set(), s2: new Set() };
        const evs = this.state.evaluations[c.id]?.[sId];
        if (!evs) return;
        ['s1', 's2'].forEach(sem => {
          (evs[sem] || []).forEach(e => {
            const started = students.some(st => {
              const g = this.state.grades[c.id]?.[sId]?.[st.id]?.[sem]?.[e];
              return g !== null && g !== undefined && g !== '';
            });
            if (started) active[sId][sem].add(e);
          });
        });
      });

      const deudores = [];
      students.forEach(st => {
        const pending = [];
        subjIds.forEach(sId => {
          const subject = this.state.subjects.find(s => s.id === sId);
          const evs     = this.state.evaluations[c.id]?.[sId];
          if (!evs) return;
          ['s1', 's2'].forEach(sem => {
            const missing = (evs[sem] || []).filter(e => {
              if (!active[sId][sem].has(e)) return false; // columna no iniciada → no cuenta
              const g = this.state.grades[c.id]?.[sId]?.[st.id]?.[sem]?.[e];
              return g === null || g === undefined || g === '';
            });
            if (missing.length) pending.push({
              subjectName: subject?.name || sId,
              isConc:      CONCEPTUAL_SUBJECTS.has(sId),
              sem,
              evals:       missing,
            });
          });
        });
        // Ordenar por cantidad de pendientes (más primero)
        if (pending.length) deudores.push({ student: st, pending,
          totalMissing: pending.reduce((n, p) => n + p.evals.length, 0) });
      });

      deudores.sort((a, b) => b.totalMissing - a.totalMissing);
      if (deudores.length) result.push({ course: c, deudores });
    });

    return result;
  }

  renderDeudores() {
    const data       = this._getDeudores();
    const totalAlums = data.reduce((n, c) => n + c.deudores.length, 0);
    const totalEvals = data.reduce((n, c) =>
      n + c.deudores.reduce((m, d) => m + d.totalMissing, 0), 0);

    const emptyState = `
      <div class="deudores-empty">
        <div class="deudores-ok-icon">✓</div>
        <div class="deudores-ok-title">¡Todo al día!</div>
        <div class="deudores-ok-sub">No hay evaluaciones iniciadas con registros pendientes.</div>
      </div>`;

    const courseBlocks = data.map(({ course, deudores }) => {
      const totalCourseMissing = deudores.reduce((n, d) => n + d.totalMissing, 0);

      const rows = deudores.map((d, i) => {
        const pendingLines = d.pending.map(p => {
          const semLabel = p.sem === 's1' ? '1er Sem' : '2do Sem';
          const tags = p.evals.map(e =>
            `<span class="deudor-tag${p.isConc ? ' deudor-tag-conc' : ''}">${this._esc(e)}</span>`
          ).join('');
          return `<div class="deudor-pending-row">
            <span class="deudor-subject-lbl">${this._esc(p.subjectName)}</span>
            <span class="deudor-sem-lbl">${semLabel}</span>
            <span class="deudor-tags">${tags}</span>
          </div>`;
        }).join('');

        return `
          <div class="deudor-student-row">
            <div class="deudor-student-name">
              <span class="deudor-idx">${i + 1}</span>
              <span>${this._esc(d.student.name)}</span>
              <span class="deudor-count-badge">${d.totalMissing} pendiente${d.totalMissing !== 1 ? 's' : ''}</span>
            </div>
            <div class="deudor-pending-list">${pendingLines}</div>
          </div>`;
      }).join('');

      return `
        <div class="deudores-course-block">
          <div class="deudores-course-hdr">
            <span class="deudores-course-name">${this._esc(course.name)}</span>
            <div class="deudores-course-meta">
              <span class="deudores-course-badge">${deudores.length} alumno${deudores.length !== 1 ? 's' : ''}</span>
              <span class="deudores-course-evals">${totalCourseMissing} eval.</span>
            </div>
          </div>
          <div class="deudores-students">${rows}</div>
        </div>`;
    }).join('');

    return `
      <div class="topbar">
        <div class="breadcrumb">
          <span class="bc-course">Deudores de Notas</span>
        </div>
        <div class="topbar-actions">
          ${data.length > 0 ? `<button class="btn-add" data-action="export-deudores">${this._icon('download')} Exportar CSV</button>` : ''}
        </div>
      </div>
      ${data.length > 0 ? `
        <div class="deudores-summary">
          <strong>${totalAlums}</strong> alumno${totalAlums !== 1 ? 's' : ''} con evaluaciones pendientes
          &nbsp;·&nbsp;
          <strong>${totalEvals}</strong> evaluacion${totalEvals !== 1 ? 'es' : ''} por completar
          <span class="deudores-summary-hint">· Solo evalúa columnas que ya tienen al menos una nota ingresada</span>
        </div>` : ''}
      <div class="deudores-body">
        ${data.length === 0 ? emptyState : courseBlocks}
      </div>`;
  }

  _exportDeudoresCSV() {
    const data = this._getDeudores();
    if (!data.length) { this.toast('No hay deudores para exportar', 'warn'); return; }

    const esc = v => `"${String(v).replace(/"/g,'""')}"`;
    const rows = [
      [esc('Curso'), esc('Alumno'), esc('Asignatura'), esc('Semestre'), esc('Evaluaciones pendientes')].join(',')
    ];

    data.forEach(({ course, deudores }) => {
      deudores.forEach(d => {
        d.pending.forEach(p => {
          rows.push([
            esc(course.name),
            esc(d.student.name),
            esc(p.subjectName),
            esc(p.sem === 's1' ? '1er Semestre' : '2do Semestre'),
            esc(p.evals.join(', ')),
          ].join(','));
        });
      });
    });

    const blob = new Blob([`﻿${rows.join('\n')}`], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `Deudores_${this.state.year}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Deudores exportados ✓');
  }

  // ── Taller JEC ───────────────────────────────────────────────────────────────

  _fmtDateES(dateStr) {
    if (!dateStr) return 'Sin fecha';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt   = new Date(y, m - 1, d);
    const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const mons = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${days[dt.getDay()]} ${d} de ${mons[m - 1]} de ${y}`;
  }

  renderTaller() {
    const cId    = this.state.activeCourse;
    const course = this.state.courses.find(c => c.id === cId);
    const entries = [...(this.state.taller[cId] || [])]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);

    const today = new Date().toISOString().slice(0, 10);

    const body = entries.length === 0
      ? `<div class="taller-empty">
           <div class="taller-empty-icon">📓</div>
           <p>Sin entradas aún.<br>Haz clic en <strong>Nueva clase</strong> para comenzar la bitácora.</p>
         </div>`
      : entries.map((entry, i) => `
          <div class="taller-entry" data-entry-id="${entry.id}">
            <div class="taller-entry-header">
              <div class="taller-entry-left">
                <span class="taller-entry-num">Clase ${entries.length - i}</span>
                <span class="taller-entry-date-label">${this._esc(this._fmtDateES(entry.date))}</span>
              </div>
              <div class="taller-entry-right">
                <input type="date" class="taller-date-input"
                       data-action="taller-date" data-id="${entry.id}"
                       value="${entry.date || today}"
                       title="Cambiar fecha">
                <button class="taller-del-btn" data-action="del-taller-entry" data-id="${entry.id}" title="Eliminar entrada">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>
            <textarea class="taller-textarea"
                      data-action="taller-text" data-id="${entry.id}"
                      placeholder="Describe lo trabajado en esta clase..."
                      rows="4">${this._esc(entry.content || '')}</textarea>
          </div>`).join('');

    return `
      <div class="topbar">
        <div class="breadcrumb">
          <span class="bc-course">${this._esc(course?.name || '')}</span>
          <span class="bc-sep">›</span>
          <span class="bc-subject">Taller JEC</span>
          <span class="bc-conc-tag" style="background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7">Bitácora</span>
        </div>
        <div class="topbar-actions">
          ${entries.length > 0 ? `<button class="btn-add btn-add-secondary" data-action="export-taller">${this._icon('download')} Exportar</button>` : ''}
          <button class="btn-add" data-action="add-taller-entry">+ Nueva clase</button>
        </div>
      </div>
      <div class="taller-body">${body}</div>`;
  }

  _exportTallerCSV() {
    const cId    = this.state.activeCourse;
    const course = this.state.courses.find(c => c.id === cId);
    const entries = [...(this.state.taller[cId] || [])]
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
    if (!entries.length) { this.toast('No hay entradas para exportar', 'warn'); return; }
    const esc  = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      [esc('Fecha'), esc('Descripción')].join(','),
      ...entries.map(e => [esc(e.date || ''), esc(e.content || '')].join(',')),
    ];
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `TallerJEC_${course?.name || ''}_${this.state.year}.csv`.replace(/[\\/:*?"<>|]/g, '_'),
    });
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Taller JEC exportado ✓');
  }

  // ── Observaciones ─────────────────────────────────────────────────────────────

  renderObservaciones() {
    const cId      = this.state.activeCourse;
    const course   = this.state.courses.find(c => c.id === cId);
    const students = this.state.students[cId] || [];
    const obsMap   = this.state.observations[cId] || {};
    const today    = new Date().toISOString().slice(0, 10);

    if (!students.length) {
      return `
        <div class="topbar">
          <div class="breadcrumb">
            <span class="bc-course">${this._esc(course?.name || '')}</span>
            <span class="bc-sep">›</span>
            <span class="bc-subject">Observaciones</span>
          </div>
        </div>
        <div class="taller-empty">
          <div class="taller-empty-icon">📝</div>
          <p>Sin alumnos registrados en este curso.</p>
        </div>`;
    }

    const totalEntries = Object.values(obsMap).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);

    const cards = students.map((st, idx) => {
      const entries = [...(obsMap[st.id] || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
      const count = entries.length;

      const entryRows = entries.map(entry => `
        <div class="obs-entry">
          <div class="obs-entry-header">
            <div class="obs-entry-date-wrap">
              <input type="date" class="taller-date-input obs-date-input"
                     data-action="obs-date" data-student="${st.id}" data-id="${entry.id}"
                     value="${entry.date || today}" title="Cambiar fecha">
              <span class="obs-entry-date-label">${this._esc(this._fmtDateES(entry.date))}</span>
            </div>
            <button class="taller-del-btn" data-action="del-obs-entry"
                    data-student="${st.id}" data-id="${entry.id}" title="Eliminar observación">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
          <textarea class="taller-textarea obs-textarea"
                    data-action="obs-text" data-student="${st.id}" data-id="${entry.id}"
                    placeholder="Escribe la observación..."
                    rows="3">${this._esc(entry.content || '')}</textarea>
        </div>`).join('');

      return `
        <div class="obs-student-block" data-student-block="${st.id}">
          <div class="obs-student-header" data-action="toggle-obs-student" title="Ver observaciones">
            <div class="obs-student-id">
              <span class="obs-chevron">▶</span>
              <span class="obs-student-num">${idx + 1}</span>
              <span class="obs-student-name">${this._esc(st.name)}</span>
              ${count > 0 ? `<span class="obs-count-badge">${count} obs.</span>` : ''}
            </div>
            <button class="btn-obs-add" data-action="add-obs-entry" data-student="${st.id}" title="Nueva observación">
              + Nueva observación
            </button>
          </div>
          <div class="obs-entries">${entryRows}</div>
        </div>`;
    }).join('');

    return `
      <div class="topbar">
        <div class="breadcrumb">
          <span class="bc-course">${this._esc(course?.name || '')}</span>
          <span class="bc-sep">›</span>
          <span class="bc-subject">Observaciones</span>
          <span class="bc-conc-tag" style="background:#fff8e1;color:#e65100;border-color:#ffcc02">Borrador</span>
        </div>
        <div class="topbar-actions">
          ${totalEntries > 0 ? `<button class="btn-add btn-add-secondary" data-action="export-obs">${this._icon('download')} Exportar</button>` : ''}
        </div>
      </div>
      <div class="obs-hint-bar">
        Borrador privado para el libro de clases. Los cambios se guardan automáticamente. ${totalEntries} observación${totalEntries !== 1 ? 'es' : ''} registrada${totalEntries !== 1 ? 's' : ''}.
      </div>
      <div class="obs-body">${cards}</div>`;
  }

  _exportObsCSV() {
    const cId      = this.state.activeCourse;
    const course   = this.state.courses.find(c => c.id === cId);
    const students = this.state.students[cId] || [];
    const obsMap   = this.state.observations[cId] || {};
    const esc      = v => `"${String(v).replace(/"/g, '""')}"`;
    const rows     = [[esc('Alumno'), esc('Fecha'), esc('Observación')].join(',')];
    students.forEach(st => {
      const entries = [...(obsMap[st.id] || [])]
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
      entries.forEach(e => rows.push([esc(st.name), esc(e.date || ''), esc(e.content || '')].join(',')));
    });
    if (rows.length <= 1) { this.toast('No hay observaciones para exportar', 'warn'); return; }
    const blob = new Blob([`﻿${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `Observaciones_${course?.name || ''}_${this.state.year}.csv`.replace(/[\\/:*?"<>|]/g, '_'),
    });
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Observaciones exportadas ✓');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  init() {
    this.load();
    this._bindAll();
    this.render();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gb = new GradeBook();
  window.gb.init();
});
