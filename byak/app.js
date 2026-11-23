/* ============================================================
   byak — app logic
   Reads rows from Supabase, listens to realtime, lets the visitor
   flip a single boolean. Without keys it shows an empty state.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- config ---------- */
  const CFG = Object.assign({
    supabaseUrl: '',
    supabaseAnonKey: '',
    passcode: '',
    authEmail: '',
    title: 'byak',
    greetingName: '',
    timeZone: undefined,
  }, window.BYAK_CONFIG || {});

  const DEMO = !CFG.supabaseUrl || !CFG.supabaseAnonKey;
  // Real sign-in: needs keys and the single account email.
  const AUTH_MODE = !DEMO && Boolean(CFG.authEmail);
  const IS_LOCAL_FILE = location.protocol === 'file:';

  const el = {};
  const state = {
    tasks: [],
    entries: [],
    reports: [],
    filter: 'active',
    view: 'tasks',
    loading: true,
    error: null,
    errors: {},
    lastSync: 0,
  };

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k, fallback) {
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- dates ---------- */
  const TZ = CFG.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  function isoToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  function isoOf(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }

  function dateFromIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }

  function daysFromToday(iso) {
    const a = dateFromIso(isoToday()).getTime();
    const b = dateFromIso(iso).getTime();
    return Math.round((b - a) / 86400000);
  }

  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  function fmtDateShort(iso) {
    const d = dateFromIso(iso);
    const today = isoToday();
    const diff = daysFromToday(iso);
    if (iso === today) return 'сегодня';
    if (diff === 1) return 'завтра';
    if (diff === -1) return 'вчера';
    const base = d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()];
    const sameYear = iso.slice(0, 4) === today.slice(0, 4);
    return sameYear ? base : base + ' ' + iso.slice(0, 4);
  }

  function fmtDateLong(iso) {
    const d = dateFromIso(iso);
    return d.getUTCDate() + ' ' + MONTHS_FULL[d.getUTCMonth()] + ' ' +
      d.getUTCFullYear() + ', ' + WEEKDAYS_FULL[d.getUTCDay()];
  }

  function fmtStamp(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return isoOf(value) === isoToday()
      ? 'сегодня'
      : fmtDateShort(isoOf(value));
  }

  function greeting() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hour: '2-digit', hour12: false,
    }).format(new Date()));
    let word = 'Доброй ночи';
    if (hour >= 5 && hour < 12) word = 'Доброе утро';
    else if (hour >= 12 && hour < 18) word = 'Добрый день';
    else if (hour >= 18 && hour < 23) word = 'Добрый вечер';
    return word + (CFG.greetingName ? ', ' + CFG.greetingName : '');
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------- markdown ---------- */
  function mdToHtml(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let list = null;
    let para = [];

    const flushPara = () => {
      if (para.length) {
        out.push('<p>' + inline(para.join(' ')) + '</p>');
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>');
        list = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) { flushPara(); flushList(); continue; }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushPara(); flushList();
        const level = Math.min(heading[1].length + 1, 4);
        out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        continue;
      }

      if (/^([-*_])\1{2,}$/.test(line.trim())) {
        flushPara(); flushList();
        out.push('<hr>');
        continue;
      }

      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushPara(); flushList();
        out.push('<blockquote>' + inline(quote[1]) + '</blockquote>');
        continue;
      }

      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((bullet || numbered)[1]);
        continue;
      }

      flushList();
      para.push(line.trim());
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  function inline(text) {
    let s = escapeHtml(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }

  /* Plain text for list previews: no markup, headings or blank lines */
  function previewText(src, options) {
    const withBullets = !options || options.bullets !== false;
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const parts = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (/^#{1,6}\s/.test(t)) continue;
      if (/^([-*_])\1{2,}$/.test(t)) continue;
      const bullet = t.match(/^[-*•]\s+(.*)$/);
      const numbered = t.match(/^\d+[.)]\s+(.*)$/);
      const body = bullet ? bullet[1] : numbered ? numbered[1] : t.replace(/^>\s?/, '');
      const clean = body.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      parts.push((bullet || numbered) && withBullets ? '· ' + clean : clean);
    }
    return parts.join(' ');
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  let toastHideTimer = null;

  function hideToast() {
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toastTimer = null;
    el.toast.classList.remove('is-visible');
    toastHideTimer = setTimeout(() => {
      el.toast.hidden = true;
      el.toast.classList.remove('toast--action');
      el.toast.textContent = '';
      toastHideTimer = null;
    }, 260);
  }

  function toast(message, action) {
    if (!el.toast) return;
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toastTimer = null;
    toastHideTimer = null;
    el.toast.hidden = true;
    el.toast.classList.remove('toast--action');
    el.toast.textContent = '';

    const text = document.createElement('span');
    text.textContent = message;
    el.toast.appendChild(text);

    if (action) {
      el.toast.classList.add('toast--action');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        hideToast();
        action.onClick();
      }, { once: true });
      el.toast.appendChild(btn);
    }

    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('is-visible'));
    toastTimer = setTimeout(hideToast, action ? 5200 : 2300);
  }

  /* ---------- backend ---------- */
  let sb = null;

  function makeClient() {
    if (DEMO || !window.supabase) return null;
    try {
      return window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    } catch (err) {
      console.error('[byak] не удалось создать клиент', err);
      return null;
    }
  }

  async function signInWithCode(code) {
    if (!sb || !CFG.authEmail) return { error: { message: 'Вход не настроен' } };
    const attempt = sb.auth.signInWithPassword({ email: CFG.authEmail, password: code });
    const guard = new Promise((resolve) => {
      setTimeout(() => resolve({ error: { message: 'timeout' } }), 15000);
    });
    return Promise.race([attempt, guard]);
  }

  async function hasSession() {
    if (!sb) return false;
    try {
      const { data } = await sb.auth.getSession();
      return Boolean(data && data.session);
    } catch (e) {
      return false;
    }
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve) => {
        setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), ms);
      }),
    ]);
  }

  function updateSyncNote() {
    if (!el.errorNote) return;
    const failed = state.error && !DEMO;
    el.errorNote.hidden = !failed;
    if (failed && el.errorText) el.errorText.textContent = state.error;
  }

  function skeleton(count, tall) {
    const cls = tall ? 'skeleton skeleton--tall' : 'skeleton';
    return new Array(count).fill('<div class="' + cls + '"></div>').join('');
  }

  function describeLoadError(results) {
    const messages = results.map(r => String((r.error && r.error.message) || '')).join(' ');
    const denied = /permission denied|jwt|invalid api key|401|403|row-level security|schema cache/i.test(messages);
    if (denied) {
      return 'Сервер не пустил к данным. Проверьте вход и ключи в config.js.';
    }
    return 'Не удалось связаться с сервером. Проверьте связь и нажмите «Повторить».';
  }

  function fetchAll() {
    const once = (label, build) => withTimeout(build(), 9000).then((first) => {
      if (!first.error) return first;
      // Network hiccups are per-request: retry just this one.
      return withTimeout(build(), 9000).then((second) => ({
        data: second.data || first.data,
        error: second.error,
        label,
      }));
    });

    return Promise.all([
      once('tasks', () => sb.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })),
      once('entries', () => sb.from('entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      once('reports', () => sb.from('reports').select('*').order('created_at', { ascending: false })),
    ]);
  }

  async function loadAll() {
    if (!sb) { state.loading = false; render(); return; }

    state.loading = true;
    state.error = null;
    state.errors = {};
    updateSyncNote();
    render();

    const [tasks, entries, reports] = await fetchAll();

    state.errors = {
      tasks: tasks.error ? 'Не удалось загрузить дела' : null,
      entries: entries.error ? 'Не удалось загрузить дневник' : null,
      reports: reports.error ? 'Не удалось загрузить отчёты' : null,
    };

    const failed = [tasks, entries, reports].filter(r => r.error);
    if (failed.length === 3) {
      state.error = describeLoadError([tasks, entries, reports]);
      console.error('[byak] загрузка не удалась', failed.map(r => r.error && r.error.message));
    } else if (failed.length) {
      state.error = 'Часть данных не загрузилась. Нажмите «Повторить».';
      console.error('[byak] частичная загрузка', failed.map(r => r.label + ': ' + (r.error && r.error.message)));
    }

    state.tasks = tasks.data || state.tasks;
    state.entries = entries.data || state.entries;
    state.reports = reports.data || state.reports;
    state.loading = false;
    state.lastSync = Date.now();
    updateSyncNote();
    render();
  }

  function subscribeRealtime() {
    if (!sb) return;
    sb.channel('byak-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onTaskChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, onEntryChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, onReportChange)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[byak] realtime недоступен:', status);
        }
      });
  }

  function upsertInto(list, row) {
    const i = list.findIndex(x => x.id === row.id);
    if (i === -1) list.push(row);
    else list[i] = row;
  }

  function onTaskChange(payload) {
    if (payload.eventType === 'DELETE') {
      state.tasks = state.tasks.filter(t => t.id !== payload.old.id);
    } else if (payload.new) {
      upsertInto(state.tasks, payload.new);
    }
    render();
  }

  function onEntryChange(payload) {
    if (payload.eventType === 'DELETE') state.entries = state.entries.filter(e => e.id !== payload.old.id);
    else if (payload.new) upsertInto(state.entries, payload.new);
    if (state.view === 'diary') render();
  }

  function onReportChange(payload) {
    if (payload.eventType === 'DELETE') state.reports = state.reports.filter(r => r.id !== payload.old.id);
    else if (payload.new) upsertInto(state.reports, payload.new);
    if (state.view === 'reports') render();
  }

  /* ---------- offline queue ---------- */
  const QUEUE_KEY = 'byak.queue';

  function queuePush(id, isDone) {
    const q = store.json(QUEUE_KEY, []).filter(item => item.id !== id);
    q.push({ id, is_done: isDone, at: Date.now() });
    store.setJson(QUEUE_KEY, q);
  }

  async function flushQueue() {
    const q = store.json(QUEUE_KEY, []);
    if (!q.length) return;
    if (!sb) return;
    const rest = [];
    for (const item of q) {
      const { error } = await sb.from('tasks').update({ is_done: item.is_done }).eq('id', item.id);
      if (error) rest.push(item);
    }
    store.setJson(QUEUE_KEY, rest);
    if (!rest.length) toast('Отметки отправлены');
  }

  /* ---------- toggle ---------- */
  async function saveTask(id, isDone) {
    if (DEMO || !sb) return true;
    const { error } = await sb.from('tasks').update({ is_done: isDone }).eq('id', id);
    if (error) {
      console.error('[byak] toggle', error.message);
      return false;
    }
    return true;
  }

  function toggleTask(id, card) {
    const task = state.tasks.find(t => t.id === id);
    if (!task || task._busy) return;

    const next = !task.is_done;
    const prevDoneAt = task.done_at;

    task.is_done = next;
    task.done_at = next ? new Date().toISOString() : null;
    task.updated_at = new Date().toISOString();
    task._busy = true;

    // instant feedback: draw the tick now, refresh the list a moment later
    if (card) {
      card.classList.toggle('is-done', next);
      card.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
    renderSummary();

    const settle = () => {
      task._busy = false;
      render();
    };

    const undo = async () => {
      task.is_done = !next;
      task.done_at = prevDoneAt;
      const ok = await saveTask(id, task.is_done);
      task._busy = false;
      render();
      toast(ok ? 'Вернули как было' : 'Не удалось отменить');
    };

    if (DEMO) {
      setTimeout(settle, 460);
      toast(next ? 'Сделано' : 'Вернули в работу', { label: 'Отменить', onClick: undo });
      return;
    }

    if (!navigator.onLine) {
      queuePush(id, next);
      task._busy = false;
      render();
      toast('Нет сети — отправим позже');
      return;
    }

    saveTask(id, next).then((ok) => {
      if (!ok) {
        task.is_done = !next;
        task.done_at = prevDoneAt;
        task._busy = false;
        render();
        toast('Не получилось сохранить');
        return;
      }
      setTimeout(settle, 460);
      toast(next ? 'Сделано' : 'Вернули в работу', { label: 'Отменить', onClick: undo });
    });
  }

  /* ---------- render ---------- */
  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>';

  function render() {
    if (!el.shell || el.shell.hidden) return;
    renderHeading();
    if (state.view === 'tasks') renderTasks();
    else if (state.view === 'diary') renderDiary();
    else renderReports();
  }

  function renderHeading() {
    if (!el.heading) return;
    const today = isoToday();
    if (state.view === 'tasks') {
      el.eyebrow.textContent = fmtDateLong(today);
      el.heading.textContent = greeting();
    } else if (state.view === 'diary') {
      el.eyebrow.textContent = state.entries.length
        ? 'записей: ' + state.entries.length
        : 'пока пусто';
      el.heading.textContent = 'Дневник';
    } else {
      el.eyebrow.textContent = state.reports.length
        ? 'отчётов: ' + state.reports.length
        : 'пока нет';
      el.heading.textContent = 'Отчёты';
    }
  }

  function renderSummary() {
    const today = isoToday();
    const active = state.tasks.filter(t => !t.is_done);
    const late = active.filter(t => t.due_date && t.due_date < today).length;
    const dueToday = active.filter(t => t.due_date === today).length;
    const doneToday = state.tasks.filter(t => t.is_done && isoOf(t.done_at) === today).length;

    const pills = [];
    if (late) pills.push('<span class="stat stat--hot"><b>' + late + '</b> ' + plural(late, 'просрочено', 'просрочено', 'просрочено') + '</span>');
    if (dueToday) pills.push('<span class="stat"><b>' + dueToday + '</b> сегодня</span>');
    if (doneToday) pills.push('<span class="stat stat--good"><b>' + doneToday + '</b> ' + plural(doneToday, 'сделано', 'сделано', 'сделано') + '</span>');
    if (!pills.length) {
      const open = active.length;
      pills.push(open
        ? '<span class="stat"><b>' + open + '</b> ' + plural(open, 'открытое дело', 'открытых дела', 'открытых дел') + '</span>'
        : '<span class="stat stat--good">Всё сделано</span>');
    }
    el.summary.innerHTML = pills.join('');
  }

  function taskChipMeta(task) {
    const chips = [];
    if (task.category && task.category !== 'общее') {
      chips.push('<span class="chip chip--cat">' + escapeHtml(task.category) + '</span>');
    }
    if (task.due_date) {
      const diff = daysFromToday(task.due_date);
      if (!task.is_done && diff < 0) {
        const n = Math.abs(diff);
        chips.push('<span class="chip chip--late">' + (n === 1 ? 'просрочено на день' : 'просрочено на ' + n + ' ' + plural(n, 'день', 'дня', 'дней')) + '</span>');
      } else if (diff === 0) {
        chips.push('<span class="chip chip--today">сегодня</span>');
      } else {
        chips.push('<span class="chip">' + fmtDateShort(task.due_date) + '</span>');
      }
    }
    if (task.priority >= 2) {
      chips.push('<span class="chip chip--prio">' + (task.priority === 3 ? 'важно' : 'важное') + '</span>');
    }
    return chips.length ? '<div class="task__meta">' + chips.join('') + '</div>' : '';
  }

  function taskCard(task, index) {
    const classes = ['task'];
    if (task.is_done) classes.push('is-done');
    return '<button class="' + classes.join(' ') + '" style="--i:' + index + '" data-task="' + escapeHtml(task.id) + '" ' +
      'aria-pressed="' + (task.is_done ? 'true' : 'false') + '">' +
      '<span class="task__check">' + CHECK_SVG + '</span>' +
      '<span class="task__body">' +
        '<span class="task__title">' + escapeHtml(task.title) + '</span>' +
        (task.note ? '<span class="task__note">' + escapeHtml(task.note) + '</span>' : '') +
        taskChipMeta(task) +
      '</span></button>';
  }

  function groupHtml(title, items, opts) {
    if (!items.length) return '';
    const tone = opts && opts.tone === 'hot' ? ' group__title--hot' : '';
    const startIndex = (opts && opts.startIndex) || 0;
    return '<section class="group">' +
      '<div class="group__head">' +
        '<span class="group__title' + tone + '">' + escapeHtml(title) + '</span>' +
        '<span class="group__count">' + items.length + '</span>' +
      '</div>' +
      '<div class="stack">' +
        items.map((t, i) => taskCard(t, startIndex + i)).join('') +
      '</div></section>';
  }

  function sortActive(a, b) {
    if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return String(a.created_at).localeCompare(String(b.created_at));
  }

  function renderTasks() {
    if (state.loading) {
      el.summary.innerHTML = '';
      el.tasksList.innerHTML = skeleton(5);
      return;
    }
    if (state.errors.tasks && !state.tasks.length) {
      el.summary.innerHTML = '';
      el.tasksList.innerHTML = emptyState('Нет данных', state.error || 'Повторите попытку позже.');
      return;
    }
    renderSummary();
    const today = isoToday();
    const all = state.tasks.slice();
    const active = all.filter(t => !t.is_done).sort(sortActive);
    const done = all.filter(t => t.is_done)
      .sort((a, b) => String(b.done_at || b.updated_at).localeCompare(String(a.done_at || a.updated_at)));

    let html = '';

    if (state.filter === 'active') {
      const late = active.filter(t => t.due_date && t.due_date < today);
      const dueToday = active.filter(t => t.due_date === today);
      const soon = active.filter(t => t.due_date && t.due_date > today);
      const someday = active.filter(t => !t.due_date);

      html += groupHtml('Просрочено', late, { tone: 'hot' });
      html += groupHtml('Сегодня', dueToday);
      html += groupHtml('Скоро', soon, { startIndex: late.length + dueToday.length });
      html += groupHtml('Без даты', someday, { startIndex: late.length + dueToday.length + soon.length });

      if (!active.length) html = emptyState('Всё чисто', 'Нет открытых дел. Новые появятся здесь, когда вы попросите агента.');
    } else if (state.filter === 'done') {
      html = done.length
        ? groupHtml('Сделано', done.slice(0, 60))
        : emptyState('Пока ничего', 'Отмеченные дела будут собираться здесь.');
    } else {
      html += groupHtml('Открытые', active);
      if (done.length) html += groupHtml('Сделано', done.slice(0, 40), { startIndex: active.length });
      if (!active.length && !done.length) html = emptyState('Пусто', 'Здесь появятся дела, которые вы добавите через чат с агентом.');
    }

    el.tasksList.innerHTML = html;
  }

  function emptyState(title, hint) {
    return '<div class="empty">' +
      '<div class="empty__mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 7.5l2.2 2.2L10.5 5.5M4.5 15.5l2.2 2.2 3.8-4.2M14 8h5.5M14 16h5.5"/></svg></div>' +
      '<p class="empty__title">' + escapeHtml(title) + '</p>' +
      '<p class="empty__hint">' + escapeHtml(hint) + '</p></div>';
  }

  function renderDiary() {
    if (state.loading) { el.diaryList.innerHTML = skeleton(3, true); return; }
    if (state.errors.entries && !state.entries.length) {
      el.diaryList.innerHTML = emptyState('Нет данных', state.error || 'Повторите попытку позже.');
      return;
    }
    const entries = state.entries.slice().sort((a, b) => {
      const d = String(b.entry_date).localeCompare(String(a.entry_date));
      return d !== 0 ? d : String(b.created_at).localeCompare(String(a.created_at));
    });

    if (!entries.length) {
      el.diaryList.innerHTML = emptyState('Дневник пуст', 'Попросите агента записать день — запись появится здесь через секунду.');
      return;
    }

    const MOOD = { '-2': '😞', '-1': '😕', '0': '😐', '1': '🙂', '2': '😊' };
    el.diaryList.innerHTML = entries.map((entry, i) => {
      const mood = entry.mood != null ? (MOOD[String(entry.mood)] || '') : '';
      const tags = Array.isArray(entry.tags) && entry.tags.length
        ? '<div class="entry__tags">' + entry.tags.map(t => '<span class="chip">#' + escapeHtml(t) + '</span>').join('') + '</div>'
        : '';
      return '<button class="entry" style="--i:' + i + '" data-entry="' + escapeHtml(entry.id) + '">' +
        '<div class="entry__top">' +
          '<span class="entry__date">' + fmtDateShort(entry.entry_date) + '</span>' +
          (mood ? '<span class="entry__mood" aria-hidden="true">' + mood + '</span>' : '') +
        '</div>' +
        (entry.title ? '<div class="entry__title">' + escapeHtml(entry.title) + '</div>' : '') +
        '<div class="entry__body">' + escapeHtml(previewText(entry.body)) + '</div>' +
        tags +
      '</button>';
    }).join('');
  }

  function reportPeriod(report) {
    if (report.period_start && report.period_end) {
      return fmtDateShort(report.period_start) + ' — ' + fmtDateShort(report.period_end);
    }
    return fmtStamp(report.created_at);
  }

  function renderReports() {
    if (state.loading) { el.reportsList.innerHTML = skeleton(3, true); return; }
    if (state.errors.reports && !state.reports.length) {
      el.reportsList.innerHTML = emptyState('Нет данных', state.error || 'Повторите попытку позже.');
      return;
    }
    const reports = state.reports.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    if (!reports.length) {
      el.reportsList.innerHTML = emptyState('Отчётов пока нет', 'Попросите агента собрать отчёт за неделю или месяц — он появится здесь.');
      return;
    }

    el.reportsList.innerHTML = reports.map((report, i) => {
      const excerpt = previewText(report.body_md, { bullets: false });
      return '<button class="report" style="--i:' + i + '" data-report="' + escapeHtml(report.id) + '">' +
        '<div class="report__meta"><span>' + escapeHtml(reportPeriod(report)) + '</span><span class="dot"></span><span>отчёт</span></div>' +
        '<div class="report__title">' + escapeHtml(report.title) + '</div>' +
        '<div class="report__excerpt">' + escapeHtml(excerpt) + '</div>' +
      '</button>';
    }).join('');
  }

  /* ---------- sheet ---------- */
  let lastFocused = null;

  function openModal(meta, title, bodyHtml) {
    lastFocused = document.activeElement;
    el.modalMeta.textContent = meta || '';
    el.modalTitle.textContent = title || '';
    el.modalBody.innerHTML = bodyHtml;
    el.modalBody.scrollTop = 0;
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => { if (el.modalClose) el.modalClose.focus(); }, 30);
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openEntry(id) {
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return;
    const tags = Array.isArray(entry.tags) && entry.tags.length ? ' · ' + entry.tags.map(t => '#' + t).join(' ') : '';
    openModal(fmtDateLong(entry.entry_date) + tags, entry.title || 'Запись', '<div class="prose prose--plain">' + escapeHtml(entry.body) + '</div>');
  }

  function openReport(id) {
    const report = state.reports.find(r => r.id === id);
    if (!report) return;
    openModal(reportPeriod(report), report.title, mdToHtml(report.body_md));
  }

  /* ---------- views ---------- */
  function setView(view) {
    state.view = view;
    $$('.tabbar__btn').forEach(btn => {
      const active = btn.dataset.view === view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
    el.viewTasks.hidden = view !== 'tasks';
    el.viewDiary.hidden = view !== 'diary';
    el.viewReports.hidden = view !== 'reports';
    store.set('byak.view', view);
    try {
      history.replaceState(null, '', view === 'tasks' ? location.pathname : '#' + view);
    } catch (e) {}
    render();
    window.scrollTo({ top: 0 });
  }

  function setFilter(filter) {
    state.filter = filter;
    $$('.segmented__btn').forEach(btn => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    store.set('byak.filter', filter);
    renderTasks();
  }

  /* ---------- theme ---------- */
  const THEMES = ['auto', 'light', 'dark'];

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    store.set('byak.theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (meta) meta.setAttribute('content', dark ? '#12140f' : '#f4f1ea');
    const btn = el.themeBtn;
    if (btn) btn.setAttribute('aria-label', 'Тема: ' + ({ auto: 'как в системе', light: 'светлая', dark: 'тёмная' })[theme]);
  }

  function cycleTheme() {
    const current = document.documentElement.dataset.theme || 'auto';
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    applyTheme(next);
    toast('Тема: ' + ({ auto: 'как в системе', light: 'светлая', dark: 'тёмная' })[next]);
  }

  /* ---------- passcode ---------- */
  const UNLOCK_KEY = 'byak.unlocked';

  function gateRequired() {
    return Boolean(CFG.passcode) && store.get(UNLOCK_KEY) !== CFG.passcode;
  }

  function showGate() {
    document.documentElement.classList.add('is-gate');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#000000');
    el.gate.hidden = false;
    el.shell.hidden = true;
    setTimeout(() => { if (el.gateInput) el.gateInput.focus(); }, 60);
  }

  function unlock() {
    // Soft mode: remember the code locally.
    // With real sign-in the session is kept by the client library.
    if (!AUTH_MODE) store.set(UNLOCK_KEY, CFG.passcode);
    document.documentElement.classList.remove('is-gate');
    applyTheme(document.documentElement.dataset.theme || 'auto');
    el.gate.hidden = true;
    el.shell.hidden = false;
    bootContent();
  }

  /* ---------- boot ---------- */
  function cacheEls() {
    el.gate = $('#gate');
    el.gateForm = $('#gate-form');
    el.gateInput = $('#gate-input');
    el.gateError = $('#gate-error');
    el.shell = $('#shell');
    el.eyebrow = $('#eyebrow');
    el.heading = $('#heading');
    el.themeBtn = $('#theme-btn');
    el.summary = $('#summary');
    el.tasksList = $('#tasks-list');
    el.diaryList = $('#diary-list');
    el.reportsList = $('#reports-list');
    el.viewTasks = $('#view-tasks');
    el.viewDiary = $('#view-diary');
    el.viewReports = $('#view-reports');
    el.offlineNote = $('#offline-note');
    el.errorNote = $('#error-note');
    el.errorText = $('#error-text');
    el.retryBtn = $('#retry-btn');
    el.demoNote = $('#demo-note');
    el.modal = $('#modal');
    el.modalMeta = $('#modal-meta');
    el.modalTitle = $('#modal-title');
    el.modalBody = $('#modal-body');
    el.modalClose = $('#modal-close');
    el.toast = $('#toast');
  }

  function bindEvents() {
    if (el.themeBtn) el.themeBtn.addEventListener('click', cycleTheme);

    $$('.tabbar__btn').forEach(btn => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });

    $$('.segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    el.tasksList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-task]');
      if (!card) return;
      toggleTask(card.dataset.task, card);
    });

    el.diaryList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-entry]');
      if (!card) return;
      openEntry(card.dataset.entry);
    });

    el.reportsList.addEventListener('click', (event) => {
      const card = event.target.closest('[data-report]');
      if (!card) return;
      openReport(card.dataset.report);
    });

    el.modal.addEventListener('click', (event) => {
      if (event.target.dataset.close || event.target === el.modalClose) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !el.modal.hidden) closeModal();
    });

    // swipe down on the handle closes the sheet
    let startY = null;
    const sheet = el.modal.querySelector('.modal__sheet');
    sheet.addEventListener('touchstart', (e) => {
      if (sheet.scrollTop > 0) return;
      startY = e.touches[0].clientY;
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 110) { startY = null; closeModal(); }
    }, { passive: true });
    sheet.addEventListener('touchend', () => { startY = null; }, { passive: true });

    if (el.retryBtn) {
      el.retryBtn.addEventListener('click', () => {
        if (!navigator.onLine) { toast('Пока нет сети'); return; }
        loadAll();
      });
    }

    if (el.gateForm) {
      el.gateForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = (el.gateInput.value || '').trim();
        if (!value) return;

        if (AUTH_MODE) {
          const button = el.gateForm.querySelector('button[type="submit"]');
          if (button) { button.disabled = true; button.classList.add('is-busy'); button.setAttribute('aria-busy', 'true'); }
          const { error } = await signInWithCode(value);
          if (button) { button.disabled = false; button.classList.remove('is-busy'); button.removeAttribute('aria-busy'); }
          if (error) {
            const wrongCode = error.status === 400 || /invalid|credentials/i.test(error.message || '');
            el.gateError.textContent = wrongCode ? 'Нет.' : 'Нет связи';
            el.gateError.hidden = false;
            el.gateInput.select();
            if (navigator.vibrate) navigator.vibrate(60);
            return;
          }
          el.gateError.hidden = true;
          el.gateInput.value = '';
          unlock();
          return;
        }

        if (value === CFG.passcode.trim()) {
          el.gateError.hidden = true;
          el.gateInput.value = '';
          unlock();
        } else {
          el.gateError.hidden = false;
          el.gateInput.select();
          if (navigator.vibrate) navigator.vibrate(60);
        }
      });
    }

    window.addEventListener('online', () => {
      el.offlineNote.hidden = true;
      flushQueue();
      loadAll();
    });
    window.addEventListener('offline', () => {
      el.offlineNote.hidden = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !DEMO && Date.now() - state.lastSync > 30000) {
        loadAll();
      }
    });
  }

  function registerServiceWorker() {
    if (IS_LOCAL_FILE || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[byak] sw', err.message);
      });
    });
  }

  function restoreUiState() {
    const fromHash = (location.hash || '').replace('#', '');
    const view = ['tasks', 'diary', 'reports'].includes(fromHash) ? fromHash : store.get('byak.view');
    if (view && ['tasks', 'diary', 'reports'].includes(view)) state.view = view;
    const filter = store.get('byak.filter');
    if (filter && ['active', 'all', 'done'].includes(filter)) state.filter = filter;
  }

  let booted = false;

  async function bootContent() {
    if (booted) return;
    booted = true;

    // restore view and filter before the first render
    $$('.segmented__btn').forEach(btn => {
      const active = btn.dataset.filter === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.tabbar__btn').forEach(btn => {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
    el.viewTasks.hidden = state.view !== 'tasks';
    el.viewDiary.hidden = state.view !== 'diary';
    el.viewReports.hidden = state.view !== 'reports';

    sb = sb || makeClient();
    await loadAll();
    await flushQueue();
    subscribeRealtime();
  }

  async function start() {
    cacheEls();
    restoreUiState();

    applyTheme(document.documentElement.dataset.theme || 'auto');
    if (CFG.title) document.title = CFG.title;

    el.demoNote.hidden = !DEMO;
    if (!navigator.onLine) el.offlineNote.hidden = false;

    bindEvents();
    registerServiceWorker();

    if (!DEMO) sb = makeClient();

    if (AUTH_MODE) {
      if (!(await hasSession())) {
        showGate();
        return;
      }
    } else if (gateRequired()) {
      showGate();
      return;
    }

    el.shell.hidden = false;
    await bootContent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
