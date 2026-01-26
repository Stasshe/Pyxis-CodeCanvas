import { UnixCommandBase } from './base';
import { parseArgs } from '../../lib/getopt';

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0');
}

function formatOffset(date: Date, useUTC: boolean) {
  const offset = useUTC ? 0 : -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${pad(hours)}${pad(minutes)}`;
}

function formatZoneName(date: Date, useUTC: boolean) {
  if (useUTC) return 'UTC';
  try {
    const nf = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
    const parts = nf.formatToParts(date);
    const tn = parts.find(p => p.type === 'timeZoneName');
    return tn ? tn.value : 'LOCAL';
  } catch (e) {
    return 'LOCAL';
  }
}

/**
 * Simple POSIX-like `date` implementation.
 * Supports: -u (UTC), -R (RFC 2822), -I[fmt]/--iso-8601[=fmt], -d/--date STRING, format +FORMAT
 */
export class DateCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { flags, values, positional } = parseArgs(args, ['-d', '--date', '-I', '--iso-8601']);

    if (flags.has('--help') || flags.has('-h')) {
      return `Usage: date [OPTION]... [+FORMAT]\nDisplay or set the system date and time.\n\n  -d, --date=STRING       display time described by STRING, not 'now'\n  -u                      print or set Coordinated Universal Time (UTC)\n  -R                      output RFC 2822 compliant date\n  -I[FMT], --iso-8601[=FMT] output date in ISO 8601 format (FMT: date, hours, minutes, seconds)\n      --help               display this help and exit\nExamples:\n  date\n  date -u +"%Y-%m-%dT%H:%M:%S%z"\n`;
    }

    const useUTC = flags.has('-u') || flags.has('--utc');

    // determine source date
    let dateObj: Date;
    const dval = values.get('--date') || values.get('-d');
    if (dval) {
      const parsed = new Date(dval);
      if (isNaN(parsed.getTime())) {
        return `date: invalid date '${dval}'`;
      }
      dateObj = parsed;
    } else {
      dateObj = new Date();
    }

    // ISO options
    if (values.has('--iso-8601') || flags.has('-I')) {
      const isoArg = values.get('--iso-8601') || values.get('-I') || '';
      // default: date only
      if (!isoArg || isoArg === 'date') {
        // YYYY-MM-DD
        const y = useUTC ? dateObj.getUTCFullYear() : dateObj.getFullYear();
        const m = pad(useUTC ? dateObj.getUTCMonth() + 1 : dateObj.getMonth() + 1);
        const d = pad(useUTC ? dateObj.getUTCDate() : dateObj.getDate());
        return `${y}-${m}-${d}`;
      }

      if (isoArg === 'seconds') {
        // YYYY-MM-DDTHH:MM:SS+hhmm
        const y = useUTC ? dateObj.getUTCFullYear() : dateObj.getFullYear();
        const m = pad(useUTC ? dateObj.getUTCMonth() + 1 : dateObj.getMonth() + 1);
        const d = pad(useUTC ? dateObj.getUTCDate() : dateObj.getDate());
        const H = pad(useUTC ? dateObj.getUTCHours() : dateObj.getHours());
        const M = pad(useUTC ? dateObj.getUTCMinutes() : dateObj.getMinutes());
        const S = pad(useUTC ? dateObj.getUTCSeconds() : dateObj.getSeconds());
        const off = formatOffset(dateObj, useUTC);
        return `${y}-${m}-${d}T${H}:${M}:${S}${off}`;
      }

      // fallback: full ISO
      return dateObj.toISOString();
    }

    // RFC 2822 (-R)
    if (flags.has('-R') || flags.has('--rfc-2822')) {
      // Example: Tue, 26 Jan 2026 12:34:56 +0900
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = useUTC ? dateObj.getUTCDay() : dateObj.getDay();
      const date = useUTC ? dateObj.getUTCDate() : dateObj.getDate();
      const month = useUTC ? dateObj.getUTCMonth() : dateObj.getMonth();
      const year = useUTC ? dateObj.getUTCFullYear() : dateObj.getFullYear();
      const H = pad(useUTC ? dateObj.getUTCHours() : dateObj.getHours());
      const M = pad(useUTC ? dateObj.getUTCMinutes() : dateObj.getMinutes());
      const S = pad(useUTC ? dateObj.getUTCSeconds() : dateObj.getSeconds());
      const off = formatOffset(dateObj, useUTC);
      return `${days[day]}, ${pad(date)} ${months[month]} ${year} ${H}:${M}:${S} ${off}`;
    }

    // Check for format string in positional args (leading +)
    const fmtArg = positional.find(p => p.startsWith('+'));
    if (fmtArg) {
      const fmt = fmtArg.slice(1);
      const use = useUTC;
      const Y = use ? dateObj.getUTCFullYear() : dateObj.getFullYear();
      const m = use ? dateObj.getUTCMonth() + 1 : dateObj.getMonth() + 1;
      const d = use ? dateObj.getUTCDate() : dateObj.getDate();
      const H = use ? dateObj.getUTCHours() : dateObj.getHours();
      const M = use ? dateObj.getUTCMinutes() : dateObj.getMinutes();
      const S = use ? dateObj.getUTCSeconds() : dateObj.getSeconds();
      const replacements: Record<string, string> = {
        '%Y': String(Y),
        '%m': pad(m),
        '%d': pad(d),
        '%H': pad(H),
        '%M': pad(M),
        '%S': pad(S),
        '%s': String(Math.floor(dateObj.getTime() / 1000)),
        '%z': formatOffset(dateObj, use),
        '%Z': formatZoneName(dateObj, use),
      };
      let out = fmt;
      for (const k of Object.keys(replacements)) {
        out = out.split(k).join(replacements[k]);
      }
      return out;
    }

    // default: locale string
    if (useUTC) {
      return dateObj.toUTCString();
    }
    return dateObj.toString();
  }
}

export default DateCommand;
