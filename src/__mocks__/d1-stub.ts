/**
 * Shared D1 in-memory stub for vitest tests.
 *
 * Handles:
 *  - INSERT: parses col names + VALUES, supports ? params, 'string' literals,
 *            and numeric literals (e.g. 0, 100)
 *  - UPDATE: parses SET clause, supports ? params, 'string' literals, COALESCE(?,col)
 *  - first() / all(): simple in-memory filter by string bind arg matching
 */

export function makeD1Stub() {
  const rows: Record<string, unknown>[] = [];

  /** Parse VALUES tokens — handles ?, 'string', and numeric literals */
  function parseInsertValues(sql: string, args: unknown[]): Record<string, unknown> {
    const colMatch = sql.match(/\(\s*([\w\s,]+)\s*\)\s*VALUES/i);
    if (!colMatch) return {};
    const cols = colMatch[1]!.split(',').map((c) => c.trim());

    const valMatch = sql.match(/VALUES\s*\(([^)]+)\)/is);
    if (!valMatch) return {};
    const valStr = valMatch[1]!;

    // Tokenize: ?, 'string', or numeric literal
    const tokens: Array<{ kind: 'param' | 'str' | 'num'; val: unknown }> = [];
    const tokenRe = /(\?)|'([^']*)'|(-?\d+(?:\.\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(valStr)) !== null) {
      if (m[1]) tokens.push({ kind: 'param', val: null });
      else if (m[2] !== undefined) tokens.push({ kind: 'str', val: m[2] });
      else if (m[3] !== undefined) tokens.push({ kind: 'num', val: Number(m[3]) });
    }

    let argIdx = 0;
    const row: Record<string, unknown> = {};
    tokens.forEach((tok, i) => {
      if (i >= cols.length) return;
      const col = cols[i]!;
      if (tok.kind === 'param') row[col] = args[argIdx++];
      else row[col] = tok.val;
    });
    return row;
  }

  /** Check if a row satisfies all string bind args (WHERE clause simulation) */
  function matchRow(row: Record<string, unknown>, args: unknown[]): boolean {
    const stringArgs = args.filter((a) => typeof a === 'string') as string[];
    if (stringArgs.length === 0) return true;
    return stringArgs.every((arg) => Object.values(row).some((v) => v === arg));
  }

  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (/^\s*INSERT/i.test(sql)) {
              const row = parseInsertValues(sql, args);
              rows.push(row);

            } else if (/^\s*UPDATE/i.test(sql)) {
              // Split SET clause (comma-separated, but not inside parentheses)
              const setClause = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i)?.[1] ?? '';
              const setPairs: string[] = [];
              let depth = 0, current = '';
              for (const ch of setClause) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (ch === ',' && depth === 0) {
                  setPairs.push(current.trim());
                  current = '';
                  continue;
                }
                current += ch;
              }
              if (current.trim()) setPairs.push(current.trim());

              let argIdx = 0;
              const setOps: Array<{ col: string; value: unknown; isCoalesce: boolean }> = [];
              for (const pair of setPairs) {
                const eqIdx = pair.indexOf('=');
                const lhs = pair.slice(0, eqIdx).trim();
                const rhs = pair.slice(eqIdx + 1).trim();
                const isCoalesce = /COALESCE/i.test(rhs);

                if (/\?/.test(rhs)) {
                  setOps.push({ col: lhs, value: args[argIdx++], isCoalesce });
                } else if (/^'[^']*'$/.test(rhs)) {
                  // 'literal string'
                  setOps.push({ col: lhs, value: rhs.slice(1, -1), isCoalesce: false });
                } else if (/^-?\d+(\.\d+)?$/.test(rhs)) {
                  // numeric literal
                  setOps.push({ col: lhs, value: Number(rhs), isCoalesce: false });
                }
                // else: expression we can't easily eval — skip
              }

              const whereArgs = args.slice(argIdx);
              const targets = rows.filter((r) => matchRow(r, whereArgs));
              for (const target of targets) {
                for (const { col, value, isCoalesce } of setOps) {
                  if (isCoalesce) {
                    if (value !== null && value !== undefined) target[col] = value;
                  } else {
                    target[col] = value;
                  }
                }
              }

            } else if (/^\s*DELETE/i.test(sql)) {
              for (let i = rows.length - 1; i >= 0; i--) {
                if (matchRow(rows[i]!, args)) rows.splice(i, 1);
              }
            }
            return { meta: { changes: 1 } };
          },

          async first<T = Record<string, unknown>>() {
            const found = rows.find((r) => matchRow(r, args));
            return (found ? { ...found } : null) as T;
          },

          async all<T = Record<string, unknown>>() {
            const tenantArg = args.find(
              (a) => typeof a === 'string' && (a as string).startsWith('tenant'),
            ) as string | undefined;
            const filtered = tenantArg
              ? rows.filter((r) => r['tenantId'] === tenantArg)
              : rows.slice();
            return { results: filtered as T[] };
          },
        };
      },
    };
  }

  return { prepare, _rows: rows };
}

export function makeEnv(db: ReturnType<typeof makeD1Stub>) {
  return {
    DB: db,
    SESSIONS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    RATE_LIMIT_KV: { get: async () => null, put: async () => {} },
    MEDIA_BUCKET: {
      put: async (_key: string, _body: unknown, _opts?: unknown) => ({ key: _key, etag: 'mock-etag' }),
      get: async () => null,
      delete: async () => {},
    },
    ENVIRONMENT: 'test',
    JWT_SECRET: 'test-secret',
    PAYSTACK_SECRET_KEY: 'sk_test_mock',
    OPENROUTER_API_KEY: 'or_test_mock',
    TERMII_API_KEY: 'termii_test_mock',
    JAMB_API_KEY: 'jamb_test_mock',
    WAEC_API_KEY: 'waec_test_mock',
    AI_PLATFORM_URL: 'https://ai.test.webwaka.io',
    INTER_SERVICE_SECRET: 'inter-svc-secret',
  };
}
