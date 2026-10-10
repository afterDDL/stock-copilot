export function normalizeIndustryExpression(expression: string): string {
  return expression.trim().replace(/(?:行业|板块|股票|股)$/u, '').trim();
}

export function extractIndustryFromQuery(query: string): string | null {
  if (/取消行业(?:限制|筛选)|不限制行业|不看行业|全\s*A股|全市场|沪深北\s*A股/i.test(query)) return null;
  const prefix = /^(?:(?:请)?帮我|请|我想要|我想|我要|筛选|寻找|找些|找|选出|选择|只看|改成|换成|限定为|些|的)+/u;
  for (const clause of query.normalize('NFKC').split(/[，。；、\s]|并且|而且|且/u)) {
    const match = clause.match(/([\p{Script=Han}\p{L}\p{N}·]+?)(?:行业|板块|股票|股)/u);
    if (!match) continue;
    const candidate = (match[1] ?? '').split(/的|排序|排列/u).at(-1)?.replace(prefix, '').trim();
    if (candidate && !/^(?:沪深北)?A$/i.test(candidate) && !/(?:市值|利润|业绩|收益|股价|涨幅|回报|盘子)/u.test(candidate)) return candidate;
  }
  const explicit = query.match(/(?:改成|换成|限定为|只看|筛选|寻找|找)([^，。；、]+)$/u)?.[1];
  if (explicit && !/(?:市值|利润|业绩|收益|股价|涨幅|回报|行业限制)/u.test(explicit)) {
    return normalizeIndustryExpression(explicit);
  }
  return null;
}
