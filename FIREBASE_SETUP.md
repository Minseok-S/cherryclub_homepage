# Firebase Admin SDK 설정 가이드

## 📚 개요

푸시 알림 기능을 사용하기 위해 Firebase Admin SDK 환경 변수를 설정해야 합니다.

## 🔧 1단계: Firebase 프로젝트 설정

1. [Firebase Console](https://console.firebase.google.com/)에 접속
2. 프로젝트 선택 또는 새 프로젝트 생성
3. **프로젝트 설정** (⚙️ 아이콘) 클릭
4. **서비스 계정** 탭 선택
5. **새 비공개 키 생성** 버튼 클릭
6. JSON 파일 다운로드

## 🔧 2단계: 환경 변수 설정

`.env.local` 파일을 프로젝트 루트에 생성하고 다운로드한 JSON 파일의 값들을 입력:

```bash
# Firebase Admin SDK 설정
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40your-project-id.iam.gserviceaccount.com

# 기타 환경 변수들...
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_DATABASE=your_database_name
EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_password
JWT_SECRET=your-jwt-secret-key-here
REFRESH_TOKEN_SECRET=your-refresh-token-secret-key-here
```

## ⚠️ 중요 사항

### Private Key 설정 주의사항

- `FIREBASE_PRIVATE_KEY`는 반드시 **따옴표로 감싸야** 합니다
- 개행 문자(`\n`)가 포함되어 있어야 합니다
- 키 값이 매우 길므로 복사할 때 누락되지 않도록 주의

### 예시:

```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

## 🧪 3단계: 테스트

서버를 재시작한 후 콘솔 로그를 확인:

### ✅ 성공한 경우:

```
✅ Firebase Admin SDK 초기화 완료
```

### ❌ 실패한 경우:

```
❌ Firebase Admin SDK 초기화 실패: Missing Firebase environment variables: FIREBASE_PRIVATE_KEY
⚠️  Firebase 기능이 비활성화됩니다. 푸시 알림이 작동하지 않을 수 있습니다.
```

## 🔍 문제 해결

### 1. "Service account object must contain a string private_key property" 오류

- `FIREBASE_PRIVATE_KEY` 환경 변수가 설정되지 않았거나 빈 값
- 따옴표로 감싸져 있는지 확인
- 개행 문자(`\n`)가 포함되어 있는지 확인

### 2. "Missing Firebase environment variables" 오류

- 필수 환경 변수가 누락됨
- 오타가 있는지 확인
- `.env.local` 파일이 올바른 위치에 있는지 확인

### 3. Firebase 없이 개발하기

- 환경 변수가 설정되지 않으면 Firebase 기능이 자동으로 비활성화됩니다
- 공지사항 생성 등 핵심 기능은 정상 작동하고, 푸시 알림만 전송되지 않습니다

## 📝 추가 정보

- 프로덕션 환경에서는 Vercel/Netlify 등의 환경 변수 설정을 사용하세요
- Firebase 프로젝트에서 FCM API가 활성화되어 있는지 확인하세요
- 보안을 위해 환경 변수 파일을 git에 커밋하지 마세요
