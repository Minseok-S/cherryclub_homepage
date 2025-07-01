# API 문서

## Authentication & Security APIs

### 1. 사용자 정보 검증 API (비밀번호 찾기용)

#### POST `/api/auth/verify-user-info`

**Description**: 비밀번호 찾기 시 전화번호와 이메일이 동일한 사용자의 것인지 검증합니다.

**Request Body**:

```json
{
  "phone": "01012345678",
  "email": "user@example.com"
}
```

**Response Example (성공)**:

```json
{
  "success": true,
  "message": "사용자 정보가 확인되었습니다.",
  "userName": "김철수"
}
```

**Response Example (실패)**:

```json
{
  "success": false,
  "error": "입력하신 전화번호와 이메일이 일치하는 사용자를 찾을 수 없습니다."
}
```

**Error Codes**:

- `400`: 필수 필드 누락
- `404`: 일치하는 사용자 없음
- `500`: 서버 내부 오류

---

# 간증 카테고리 API 문서

## Frontend Design Guidelines 적용

- **Predictability**: 공지사항과 동일한 구조로 일관된 API 응답 형식
- **Single Responsibility**: 각 API가 명확한 단일 책임을 가짐
- **Cohesion**: 카테고리 관련 기능을 함께 관리

## 카테고리 종류

- `campus`: 캠퍼스
- `camp`: 캠프
- `meeting`: 모임
- `etc`: 기타

---

## 1. 간증 목록 조회 API

### GET `/api/testimonies`

**Description**: 간증 목록을 페이지네이션과 카테고리 필터링을 지원하여 조회합니다.

**Query Parameters**:

- `page` (optional): 페이지 번호 (기본값: 1)
- `page_size` (optional): 페이지 크기 (기본값: 10)
- `category` (optional): 카테고리 필터 (`campus`, `camp`, `meeting`, `etc`)

**Request Example**:

```bash
GET /api/testimonies?page=1&page_size=10&category=campus
Authorization: Bearer <token>
```

**Response Example**:

```json
{
  "success": true,
  "testimonies": [
    {
      "id": 1,
      "category": "campus",
      "content": "캠퍼스에서의 하나님 은혜 간증...",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "view_count": 25,
      "like_count": 5,
      "comment_count": 3,
      "author_id": 123,
      "author_name": "김철수",
      "author_school": "서울대학교",
      "image_urls": ["https://example.com/image1.jpg"],
      "is_liked": false
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 10,
    "has_more": true
  }
}
```

---

## 2. 간증 생성 API

### POST `/api/testimonies`

**Description**: 새로운 간증을 생성합니다.

**Headers**:

- `Authorization: Bearer <token>`

**Request Body**:

```json
{
  "category": "campus",
  "content": "캠퍼스에서의 하나님 은혜 간증 내용...",
  "image_urls": [
    "https://firebase-storage-url1.jpg",
    "https://firebase-storage-url2.jpg"
  ]
}
```

**Response Example**:

```json
{
  "success": true,
  "testimony": {
    "id": 1,
    "category": "campus",
    "content": "캠퍼스에서의 하나님 은혜 간증 내용...",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "view_count": 0,
    "like_count": 0,
    "comment_count": 0,
    "author_id": 123,
    "author_name": "김철수",
    "author_school": "서울대학교",
    "image_urls": ["https://firebase-storage-url1.jpg"],
    "is_liked": false
  }
}
```

---

## 3. 간증 상세 조회 API

### GET `/api/testimonies/[id]`

**Description**: 특정 간증의 상세 정보를 조회합니다.

**Headers**:

- `Authorization: Bearer <token>` (선택적)

**Response Example**:

```json
{
  "success": true,
  "testimony": {
    "id": 1,
    "category": "campus",
    "content": "캠퍼스에서의 하나님 은혜 간증 내용...",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "view_count": 25,
    "like_count": 5,
    "comment_count": 3,
    "author_id": 123,
    "author_name": "김철수",
    "author_school": "서울대학교",
    "image_urls": ["https://firebase-storage-url1.jpg"],
    "is_liked": false
  }
}
```

---

## 4. 간증 수정 API

### PUT `/api/testimonies/[id]`

**Description**: 기존 간증을 수정합니다.

**Headers**:

- `Authorization: Bearer <token>`

**Request Body**:

```json
{
  "category": "meeting",
  "content": "수정된 간증 내용...",
  "image_urls": [
    "https://firebase-storage-url1.jpg",
    "https://firebase-storage-url2.jpg"
  ]
}
```

**Response Example**:

```json
{
  "success": true,
  "testimony": {
    "id": 1,
    "category": "meeting",
    "content": "수정된 간증 내용...",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:45:00Z",
    "view_count": 25,
    "like_count": 5,
    "comment_count": 3,
    "author_id": 123,
    "author_name": "김철수",
    "author_school": "서울대학교",
    "image_urls": ["https://firebase-storage-url1.jpg"],
    "is_liked": false
  }
}
```

---

## 5. 간증 삭제 API

### DELETE `/api/testimonies/[id]`

**Description**: 간증을 삭제합니다.

**Headers**:

- `Authorization: Bearer <token>`

**Response Example**:

```json
{
  "success": true,
  "message": "간증이 삭제되었습니다."
}
```

---

## 에러 응답 형식

```json
{
  "error": "에러 메시지",
  "code": "ERROR_CODE" // 선택적
}
```

**공통 에러 상태 코드**:

- `400`: 잘못된 요청 (유효하지 않은 카테고리, 필수 필드 누락 등)
- `401`: 인증 필요
- `403`: 권한 없음
- `404`: 리소스를 찾을 수 없음
- `500`: 서버 내부 오류

---

## 테스트 예시

### 카테고리별 간증 조회 테스트

```bash
# 캠퍼스 카테고리 간증만 조회
curl -X GET "http://localhost:3000/api/testimonies?category=campus" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 모든 간증 조회 (카테고리 필터 없음)
curl -X GET "http://localhost:3000/api/testimonies" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 간증 생성 테스트

```bash
curl -X POST "http://localhost:3000/api/testimonies" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "campus",
    "content": "캠퍼스에서의 은혜 간증입니다.",
    "image_urls": []
  }'
```
