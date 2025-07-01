# 체리동아리 홈페이지 프로젝트 🍒

체리동아리의 공식 홈페이지 프로젝트입니다. 이 프로젝트는 Next.js 15, React 19, TypeScript 및 Tailwind CSS를 사용하여 구현되었습니다.

## 목차

- [기술 스택](#기술-스택)
- [프로젝트 설정 및 실행](#프로젝트-설정-및-실행)
- [폴더 구조](#폴더-구조)
- [협업 가이드](#협업-가이드)
- [배포](#배포)

## 기술 스택

- **프레임워크**: Next.js 15 (App Router)
- **UI 라이브러리**: React 19
- **언어**: TypeScript
- **스타일링**: Tailwind CSS
- **애니메이션**: Framer Motion, GSAP
- **UI 컴포넌트**: Slick Carousel, Swiper
- **폼 관리**: React Hook Form

## 프로젝트 설정 및 실행

### 필수 요구사항

- Node.js 18.x 이상
- npm 또는 yarn

### 로컬 환경 설정

1. 프로젝트 클론하기:

```bash
git clone [레포지토리 URL]
cd cherryclub_homepage
```

2. 종속성 설치:

```bash
npm install
# 또는
yarn install
```

3. 개발 서버 실행:

```bash
npm run dev : 개발 서버 실행

npm run build : 빌드

npm start : 배포
# 또는
yarn dev
```

4. 브라우저에서 http://192.168.0.16:3000 접속하여 확인

## 폴더 구조

```
src/
├── app/
│   ├── (route)/                # 라우트별 폴더
│   │   ├── home/               # 메인 페이지
│   │   │   ├── _components/    # 페이지별 컴포넌트
│   │   │   ├── _data/          # 데이터 파일
│   │   │   ├── _types/         # 타입 정의
│   │   │   └── page.tsx        # 페이지 컴포넌트
│   │   ├── campus/             # 캠퍼스 페이지
│   │   ├── external/           # 대외활동 페이지
│   │   ├── gatherings/         # 모임 페이지
│   │   ├── leadership/         # 리더십 페이지
│   │   └── join/               # 가입 페이지
│   ├── api/                    # API 라우트
│   ├── layout.tsx              # 루트 레이아웃
│   ├── page.tsx                # 루트 페이지
│   └── globals.css             # 전역 스타일
└── shared/                     # 공유 컴포넌트, 유틸리티 등
```

## 협업 가이드

### 브랜치 전략

- `main`: 프로덕션 브랜치
- `develop`: 개발 환경용 브랜치
- `feature/[기능명]`: 새로운 기능 개발 브랜치
- `fix/[이슈명]`: 버그 수정 브랜치

### 코드 스타일 가이드

- **컴포넌트**: 함수형 컴포넌트와 React Hooks 사용
- **명명 규칙**:
  - 파일/폴더: PascalCase (컴포넌트), camelCase (유틸)
  - 변수/함수: camelCase
- **주석 규칙**:
  - 함수나 컴포넌트 위에 간단한 설명
  - 복잡한 로직이나 해결책은 왜 그렇게 구현했는지 설명
  - 마크업보다는 로직에 주석 작성

### 코드 리뷰 프로세스

1. PR(Pull Request) 생성 시 템플릿 양식에 맞게 작성
2. 최소 1명 이상의 승인 필요
3. CI 테스트 통과 확인
4. PR 병합 후 해당 브랜치 삭제

## 배포

현재 Vercel을 통해 배포되고 있습니다.

- **개발 환경**: PR 생성 시 자동으로 프리뷰 배포
- **스테이징 환경**: `develop` 브랜치에 병합 시 자동 배포
- **프로덕션 환경**: `main` 브랜치에 병합 시 자동 배포

---

문제가 있거나 질문이 있으면 이슈를 생성하거나 팀 채널에 문의해주세요.
