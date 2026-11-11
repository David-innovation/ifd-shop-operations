'use strict';
// Project provider-confirmed appointment messages onto the existing diary fields.
// Failed/uncertain later sends must not replace the last known communicated slot.
function patch(job) {
  const out = {}, groups = new Map();
  groups.set('fitting', {visit:'', target:job, messages:[]});
  for (const [visit,target] of Object.entries(job.pre || {})) groups.set(visit,{visit,target,messages:[]});
  for (const [id, m] of Object.entries(job.msgs || {})) {
    if (m.channel !== 'sms' || !/^(fit-slot:|visit-slot:)/.test(m.rev || '') || !m.snap) continue;
    const visit = m.snap.visitId || '', target = visit ? job.pre?.[visit] : job;
    if (!target || m.snap.date !== target.date || m.snap.fitter !== (visit ? target.who : target.fitter)) continue;
    const key = visit || 'fitting';
    if (!groups.has(key)) groups.set(key, {visit, target, messages:[]});
    groups.get(key).messages.push({id, ...m});
  }
  for (const {visit, target, messages} of groups.values()) {
    const old = target.arrival || {};
    const sent = messages.filter(m => ['sent','delivered'].includes(m.state)).sort((a,b) => String(a.at).localeCompare(String(b.at))).at(-1);
    if (old.slot && !old.messageId && (!sent || String(old.at) > String(sent.at))) continue;
    const arrival = sent ? {slot:sent.snap.slot, forDate:sent.snap.date, at:sent.at, by:sent.byName || '', messageId:sent.id, method:'sms', delivery:sent.state} : old.messageId ? {slot:'', messageId:'', delivery:'unconfirmed'} : null;
    if (!arrival || Object.entries(arrival).every(([k,v]) => old[k] === v)) continue;
    if (visit) { out.pre ||= {}; out.pre[visit] = {arrival}; } else out.arrival = arrival;
  }
  return out;
}
module.exports = {patch};
