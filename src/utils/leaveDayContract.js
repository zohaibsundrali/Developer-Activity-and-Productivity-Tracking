// MyLeave has always counted inclusive calendar dates and offers half-day only
// for a single date. This validates that existing rule without rounding input.
export function leaveDayAmount(span, supplied) {
  const days=supplied===undefined?span:typeof supplied==='number'||typeof supplied==='string'&&supplied.trim()?Number(supplied):NaN;
  if(!Number.isInteger(span)||span<1||span>365||!Number.isFinite(days))return null;
  return span===1?(days===0.5||days===1?days:null):(days===span?days:null);
}
