const members = ['melodi'];

export function validCalendarReminder(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 240
    && typeof value.eventAt === 'string' && Number.isFinite(Date.parse(value.eventAt))
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
    && (value.agent === null || members.includes(value.agent));
}
