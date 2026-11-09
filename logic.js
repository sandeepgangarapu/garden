// Pure garden rules. No DOM, storage, or network access.
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function rowTime(row) { const time=Date.parse(row?.updated_at || row?.checked_at || row?.created_at || ''); return Number.isFinite(time)?time:0; }
export function rowKey(table, row) {
  if (table === 'years') return String(row.year);
  if (table === 'plantings') return `${row.year}:${row.plant_id}`;
  if (table === 'checks') return `${row.year}:${row.task_id}`;
  return row.id;
}
export function mergeRows(local, remote, key = r => r.id) {
  const rows = new Map(local.map(r => [key(r), r]));
  for (const r of remote) { const old = rows.get(key(r)); if (!old || rowTime(r) > rowTime(old)) rows.set(key(r), r); }
  return [...rows.values()];
}
export function activePlants(plants, plantings, year) {
  const ids = new Set(plantings.filter(r => r.year === year && !r.deleted && !r._deleted && r.status !== 'skipped').map(r => r.plant_id));
  return plants.filter(p => ids.has(p.id));
}
export function taskVisible(task, garden) {
  return task.plants.some(id => id === 'area:vegetables' ? garden.some(p => p.kind === 'vegetable') :
    id.startsWith('area:') ? garden.some(p => p.area === id.slice(5)) : garden.some(p => p.id === id));
}
export function taskLead(task, garden) {
  const explicit = task.plants.filter(id => !id.startsWith('area:'));
  const grown = explicit.filter(id => garden.some(p => p.id === id));
  if (task.lead && explicit.length > 1 && grown.length && grown.length < explicit.length)
    return grown.map(id => garden.find(p => p.id === id).name).join(', ');
  return task.lead;
}
export function carryOver(plants, plantings, fromYear) {
  const eligible = new Set(plants.filter(p => p.life !== 'annual').map(p => p.id));
  return plantings.filter(r => r.year === fromYear && !r.deleted && !r._deleted && r.status !== 'skipped' && eligible.has(r.plant_id)).map(r => r.plant_id);
}
export function defaultStatus(life, year, now = new Date()) {
  if (life !== 'annual') return 'growing';
  if (year < now.getFullYear()) return 'done';
  if (year > now.getFullYear()) return 'planned';
  return now.getMonth() < 10 ? 'growing' : 'done';
}
export const TABLES = ['years','plantings','custom','notes','checks'];
export const EPOCH = '1970-01-01T00:00:00.000Z';
export function seedRows(library) {
  const state=Object.fromEntries(TABLES.map(t=>[t,[]]));
  for(const year of [2026,2027]) {
    state.years.push({year,created_at:EPOCH,updated_at:EPOCH,deleted:0});
    for(const p of library.filter(p=>year===2026||p.life!=='annual'))
      state.plantings.push({year,plant_id:p.id,status:defaultStatus(p.life,year),variety:'',location:'',updated_at:EPOCH,deleted:0});
  }
  return state;
}
// A newer remote row wins even over a dirty edit. A newer local edit remains queued.
export function mergeSyncRows(local,remote,table) {
  return mergeRows(local,remote,r=>rowKey(table,r));
}
export function acknowledgeRows(state,dirty,sent) {
  for(const {table,row} of sent) {
    const key=rowKey(table,row),current=state[table].find(r=>rowKey(table,r)===key);
    if(current && rowTime(current)<=rowTime(row))dirty[table].delete(key);
  }
}
export function escapeICal(value) {
  return String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
}
export function foldICal(line) {
  const encoder = new TextEncoder(), lines = []; let current = '', bytes = 0;
  for (const char of line) { const length = encoder.encode(char).length;
    if (bytes + length > 75) { lines.push(current); current = ' '; bytes = 1; }
    current += char; bytes += length;
  }
  lines.push(current); return lines.join('\r\n');
}
export function createCalendarEvent(chore, date, time = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid date.');
  const [year,month,day] = date.split('-').map(Number), start = new Date(Date.UTC(year,month-1,day));
  if (year < 1000 || start.getUTCFullYear() !== year || start.getUTCMonth() !== month-1 || start.getUTCDate() !== day) throw new Error('Choose a valid date.');
  const dv = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
  const tv = d => `${dv(d)}T${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}00`;
  let dates;
  if (time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid time.');
    const [h,m] = time.split(':').map(Number); start.setUTCHours(h,m);
    dates = [`DTSTART:${tv(start)}`,`DTEND:${tv(new Date(+start+1800000))}`];
  } else dates = [`DTSTART;VALUE=DATE:${dv(start)}`,`DTEND;VALUE=DATE:${dv(new Date(+start+86400000))}`];
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const uid = `garden-${String(chore.id || chore.cid).replace(/[^a-zA-Z0-9-]/g,'-')}-${date}-${time || 'all-day'}@garden.sandeepgangarapu.com`;
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Gangarapu Garden//Garden chores//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    `UID:${uid}`,`DTSTAMP:${stamp}`,...dates,`SUMMARY:${escapeICal(chore.title)}`,
    `DESCRIPTION:${escapeICal(chore.category+'\n'+chore.title+'\nGarden care plan: https://garden.sandeepgangarapu.com/')}`,
    'LOCATION:Gangarapu Garden\\, Sammamish','URL:https://garden.sandeepgangarapu.com/#jobs','END:VEVENT','END:VCALENDAR'].map(foldICal).join('\r\n')+'\r\n';
}
