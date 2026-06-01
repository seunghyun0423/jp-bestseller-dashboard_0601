# JP Bestseller Trend Dashboard

Netlify Drop에 올리는 정적 웹앱입니다.

## 구성
- YouTube 크롤링 페이지
- Gemini 딕셔너리 랭킹 페이지
- 네이버 쇼핑 최저가 비교 페이지

## 사용 방법
1. 이 폴더를 ZIP으로 압축 해제합니다.
2. Netlify Drop(https://app.netlify.com/drop)에 폴더 전체를 드래그합니다.
3. 브라우저에서 API 키를 입력하고 사용합니다.

## 주의
- API 키는 브라우저 localStorage에 저장됩니다. 공개 배포용 사이트에 개인 키를 넣지 마세요.
- YouTube/Gemini API는 브라우저 직접 호출이 가능합니다.
- 네이버 쇼핑 API는 CORS 정책 때문에 정적 사이트에서 직접 호출이 막힐 수 있습니다. 이 경우 Colab에서 실행하거나 Netlify Functions 프록시가 필요합니다.
