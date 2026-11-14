"""Compare reporting content with paired quotations, never claim truth or support."""
from .models import ReportComparisons, ReportComparisonPoint


ASPECT_LABELS = {
    'topic': '보도 주제', 'event': '사건 설명', 'actors': '등장 인물·기관',
    'time': '시점·일정', 'figures': '수치·범위', 'attribution': '인용·발언',
    'focus': '강조점', 'context': '배경·맥락',
}


def comparison_material(row):
    # Tavily raw_content may itself be an excerpt; never call this a full-text comparison.
    for key, basis, limit in [('raw_content', 'body_excerpt', 8000),
                              ('content', 'search_snippet', 2000), ('title', 'title_only', 500)]:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value[:limit], basis
    return '', 'title_only'


def apply_comparisons(reports, materials, article_text, output, cited_report_ids=()):
    """IDs and BOTH literal quotations must match server-provided materials."""
    output = ReportComparisons.model_validate(output)
    by_id = {r.id: r for r in reports}
    for report in reports:
        report.comparison_status = 'insufficient'
        report.comparison_points = []
        report.cited_by_article=report.id in cited_report_ids
    seen = set()
    for comparison in output.reports:
        report = by_id.get(comparison.report_id)
        material = materials.get(comparison.report_id)
        if report is None or material is None:
            continue
        for point in comparison.points:
            key = (report.id, point.kind, point.aspect, point.article_quote, point.related_quote)
            if key in seen or point.article_quote not in article_text or point.related_quote not in material:
                continue
            seen.add(key)
            if len(report.comparison_points) < 6:
                data=point.model_dump();status='none'
                material_difference=(point.kind=='difference' and point.article_quote!=point.related_quote and point.aspect in ('event','actors','time','figures','attribution'))
                if not material_difference or (point.review_kind=='citation_difference' and not report.cited_by_article):
                    data['review_kind']='none'
                elif point.review_kind!='none':
                    shared=len(point.context_anchor)>=2 and point.context_anchor in point.article_quote and point.context_anchor in point.related_quote
                    status='paired_excerpt' if report.comparison_basis=='body_excerpt' and shared else 'needs_confirmation'
                report.comparison_points.append(ReportComparisonPoint(**data,review_status=status))
        if report.comparison_points:
            report.comparison_status = 'compared'
    for report in reports:
        if report.comparison_points:
            common = list(dict.fromkeys(ASPECT_LABELS[p.aspect] for p in report.comparison_points if p.kind == 'common'))
            different = list(dict.fromkeys(ASPECT_LABELS[p.aspect] for p in report.comparison_points if p.kind == 'difference'))
            report.differences_summary = ' / '.join(filter(None, [
                '공통으로 다룬 항목: ' + ', '.join(common) if common else '',
                '표현·강조 차이: ' + ', '.join(different) if different else '',
            ]))
        else:
            report.differences_summary = '확보한 범위에서 비교할 구절을 확인하지 못했습니다.'
