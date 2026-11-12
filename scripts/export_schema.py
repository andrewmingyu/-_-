"""Export the same strict models used by FastAPI; run from repository root."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.models import AnalyzeRequest, ArticleAnalysis, SelectionRequest, SelectionAnalysis, Preview


def schemas():
    return {model.__name__: model.model_json_schema() for model in
        (AnalyzeRequest, ArticleAnalysis, SelectionRequest, SelectionAnalysis, Preview)}


if __name__ == '__main__':
    (ROOT / 'docs/api.schema.json').write_text(json.dumps(schemas(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
