# ScanQC Web (iux-qc) — 작업 안내서

## 한 줄 요약
원본 폴더와 보정본 폴더의 스캔 이미지를 한 장씩 비교·검수하고 크롭·회전·색 보정하는 도구의 웹 버전. 기록물 DB구축 현장의 기존 검수 도구를 대체.

- 주소: https://qc.iux.kr / 관리자 `admin.html`
- 설치형(Windows): `download/ScanQC_Setup.exe`

## 확정된 결정
| 항목 | 결정 |
|---|---|
| 불러오기 | 스캔본이 커서 한 번에 다 안 불러오고 **한 장씩** (다음 버튼·자동 넘김) |
| 흐름 | 불러오면 자동 보정(기본 꺼짐) → 작업자는 검수만, 잘못된 장만 다시 수정 |
| 자동 보정 | 가장자리 검은 띠·그림자·흰 줄만, 한 변 최대 2mm. 미세 기울기 보정은 안 함 |
| 오프라인 | 인터넷 없이 동작해야 함 (현장). 학습 기록도 브라우저 안에만 |
| 로그인 | 없이도 전체 보정 기능 사용, 로그인하면 팀 작업·통계 (Supabase) |
| 관리자 | 비로그인 사용자 통계(어떤 파일로 접속해 몇 장 바꿨는지)까지 |
| 디자인 | 스포티파이 + Lucide |

## 파일
```
index.html         검수 화면 (보정 도구·단축키·자동 넘김)
admin.html         관리자 (대시보드·사용 통계·프로젝트·배정)
config.js          Supabase 연결 (비우면 '내 PC 폴더' 검수만). anon 키만
js/analyze.js      가장자리·라벨 방향 분석   · js/engine.js 자동 보정 엔진   · js/codec.js TIFF/JPEG/PNG/BMP 읽기·쓰기
supabase/schema.sql
vendor/            UTIF, pako, supabase (수정 금지)
download/          설치형 exe
```
- localStorage 키: `scanqc:*`

## 확인
`index.html`을 열고 원본/보정본 폴더 지정 → 몇 장 넘기며 보정·저장, 단축키(README 표) 동작 확인.

---

## 공통 작업 원칙 (IUX 프로젝트 전체)
- **언어:** 화면 문구·문서·커밋 메시지는 한국어. 쉬운 말, 기술 용어 최소화.
- **퍼블리싱 시안:** 순수 HTML/CSS + 간단한 스크립트만 넣는다. 서버·DB 연동 코드는 개발 단계에서 따로 붙인다.
- **아이콘:** Lucide. 디자인 시스템을 따로 정하지 않았으면 스포티파이 스타일(다크/화이트 + 포인트 컬러)을 기본으로 쓴다.
- **배포:** GitHub `main` → Vercel 자동 배포. 도메인은 가비아 `iux.kr`의 서브도메인(`*.iux.kr` CNAME → Vercel)을 쓴다.
- **DB:** Supabase 무료 플랜은 활성 프로젝트 2개까지라, 새 프로젝트를 만들지 말고 기존 `iux-cloud`(studio) 프로젝트에 테이블을 얹는 것을 먼저 검토한다.
- **비밀값:** 공개 저장소다. 서비스 키·AI 키·비밀번호는 절대 커밋하지 않는다. 키는 Vercel 환경 변수나 Supabase secrets에 둔다. Supabase anon(public) 키만 코드에 넣을 수 있다.
- **확인:** 고친 뒤에는 브라우저 콘솔 오류 0개, 모바일(390px)과 PC 화면을 눈으로 확인하고 나서 완료라고 한다.
- **브랜치:** `main`은 배포 중인 상태. 큰 작업이나 검증 전 작업은 브랜치(`wip/…`, `claude/…`)에 올리고, `main`을 강제 푸시(-f)로 덮어쓰지 않는다.
- **전체 프로젝트 목록:** https://github.com/handgoldking1234/iux-app/blob/main/docs/PROJECTS.md
