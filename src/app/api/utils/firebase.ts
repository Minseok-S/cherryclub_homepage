import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

// Firebase 초기화 상태 추적
let isFirebaseInitialized = false;
let initializationError: string | null = null;

/**
 * FCM 토큰 검증 함수
 * Frontend Design Guideline: Single Responsibility - 토큰 검증만 담당
 */
function isValidFCMToken(token: string): boolean {
  if (!token || typeof token !== "string") {
    return false;
  }

  // 빈 문자열 검사
  if (token.trim() === "") {
    return false;
  }

  // FCM 토큰은 보통 140-200자 사이의 길이를 가집니다
  if (token.length < 100 || token.length > 300) {
    return false;
  }

  // FCM 토큰은 알파벳, 숫자, 하이픈, 언더스코어, 콜론만 포함해야 합니다
  const fcmTokenPattern = /^[a-zA-Z0-9_:-]+$/;
  if (!fcmTokenPattern.test(token)) {
    return false;
  }

  // 명백히 잘못된 토큰들 필터링
  const invalidTokens = [
    "invalid_token",
    "test_token",
    "dummy_token",
    "null",
    "undefined",
    "example_token",
  ];

  if (invalidTokens.includes(token.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * 서비스 계정 JSON 파일 읽기
 * Frontend Design Guideline: Single Responsibility - JSON 파일 읽기만 담당
 */
function loadServiceAccountKey(): any | null {
  try {
    // 프로젝트 루트의 Firebase.json 파일 경로
    const serviceAccountPath = path.join(process.cwd(), "Firebase.json");

    // 파일 존재 확인
    if (!fs.existsSync(serviceAccountPath)) {
      console.warn(
        "❌ Firebase.json 파일을 찾을 수 없습니다:",
        serviceAccountPath
      );
      return null;
    }

    // JSON 파일 읽기
    const serviceAccountData = fs.readFileSync(serviceAccountPath, "utf8");
    const serviceAccount = JSON.parse(serviceAccountData);

    // 필수 필드 검증
    const requiredFields = [
      "type",
      "project_id",
      "private_key_id",
      "private_key",
      "client_email",
      "client_id",
    ];

    const missingFields = requiredFields.filter(
      (field) => !serviceAccount[field]
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Firebase.json에서 필수 필드가 누락되었습니다: ${missingFields.join(
          ", "
        )}`
      );
    }

    console.log("✅ Firebase.json 파일 로드 성공");
    return serviceAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Firebase.json 파일 로드 실패:", errorMessage);
    return null;
  }
}

/**
 * 환경 변수 기반 서비스 계정 구성 (폴백 방식)
 * Frontend Design Guideline: Predictability - 환경 변수 폴백 제공
 */
function createServiceAccountFromEnv(): any | null {
  try {
    const requiredVars = [
      "FIREBASE_PROJECT_ID",
      "FIREBASE_PRIVATE_KEY_ID",
      "FIREBASE_PRIVATE_KEY",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_CLIENT_ID",
    ];

    const missingVars = requiredVars.filter((varName) => !process.env[varName]);
    if (missingVars.length > 0) {
      console.warn(`환경 변수 누락: ${missingVars.join(", ")}`);
      return null;
    }

    // private_key 처리
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID!,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID!,
      private_key: privateKey!,
      client_email: process.env.FIREBASE_CLIENT_EMAIL!,
      client_id: process.env.FIREBASE_CLIENT_ID!,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL || "",
    };

    console.log("✅ 환경 변수로부터 서비스 계정 구성 성공");
    return serviceAccount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ 환경 변수 서비스 계정 구성 실패:", errorMessage);
    return null;
  }
}

/**
 * Firebase Admin SDK 안전 초기화
 * Frontend Design Guideline: Predictability - 일관된 초기화 결과 보장
 */
function initializeFirebaseAdmin() {
  if (isFirebaseInitialized && admin.apps.length > 0) {
    return true;
  }

  try {
    // 개발 환경에서 Firebase 설정이 없는 경우 조기 종료
    if (process.env.NODE_ENV === "development") {
      const hasJsonFile = fs.existsSync(
        path.join(process.cwd(), "Firebase.json")
      );
      const hasEnvVars = process.env.FIREBASE_PROJECT_ID;

      if (!hasJsonFile && !hasEnvVars) {
        console.log(
          "🔧 개발 환경에서 Firebase 설정이 없습니다. Firebase 기능을 건너뜁니다."
        );
        isFirebaseInitialized = false;
        initializationError =
          "Development mode: No Firebase configuration found";
        return false;
      }
    }

    // 기존 Firebase 앱 정리
    if (admin.apps.length > 0) {
      admin.apps.forEach((app) => {
        try {
          app?.delete();
        } catch (e) {
          console.warn("기존 Firebase 앱 삭제 중 오류:", e);
        }
      });
    }

    // 서비스 계정 로드 (JSON 파일 우선, 환경 변수 폴백)
    let serviceAccount = loadServiceAccountKey();

    if (!serviceAccount) {
      console.log("JSON 파일을 사용할 수 없습니다. 환경 변수를 시도합니다...");
      serviceAccount = createServiceAccountFromEnv();
    }

    if (!serviceAccount) {
      throw new Error(
        "Firebase 서비스 계정을 구성할 수 없습니다. Firebase.json 파일 또는 환경 변수를 확인하세요."
      );
    }

    // Firebase Admin SDK 초기화
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    isFirebaseInitialized = true;
    initializationError = null;
    console.log("✅ Firebase Admin SDK 초기화 완료");
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    initializationError = errorMessage;
    isFirebaseInitialized = false;

    console.error("❌ Firebase Admin SDK 초기화 실패:", errorMessage);

    if (process.env.NODE_ENV === "production") {
      console.error(
        "🚨 프로덕션 환경에서 Firebase 초기화 실패! 설정을 확인하세요."
      );
    } else {
      console.warn("⚠️  개발 환경에서 Firebase 기능이 비활성화됩니다.");
      console.log("💡 Firebase 설정 가이드:");
      console.log("   1. Firebase.json 파일을 프로젝트 루트에 배치하거나");
      console.log("   2. 환경 변수를 설정하세요 (FIREBASE_SETUP.md 참고)");
    }

    return false;
  }
}

// 초기화 시도
initializeFirebaseAdmin();

/**
 * Firebase 서비스 안전 접근
 * Frontend Design Guideline: Predictability - 안전한 서비스 접근 보장
 */
export const getMessaging = () => {
  if (!isFirebaseInitialized) {
    console.warn(
      "Firebase가 초기화되지 않았습니다. 메시징 서비스를 사용할 수 없습니다."
    );
    return null;
  }
  return admin.messaging();
};

export const getFirestore = () => {
  if (!isFirebaseInitialized) {
    console.warn(
      "Firebase가 초기화되지 않았습니다. Firestore 서비스를 사용할 수 없습니다."
    );
    return null;
  }
  return admin.firestore();
};

// 하위 호환성을 위한 레거시 export (deprecated)
export const messaging = getMessaging();
export const firestore = getFirestore();

/**
 * FCM 푸시 알림 전송 서비스
 * Frontend Design Guideline: Predictability 원칙 - 일관된 인터페이스
 */
export class FCMService {
  /**
   * Firebase 초기화 상태 확인
   */
  static isAvailable(): boolean {
    return isFirebaseInitialized;
  }

  /**
   * 초기화 오류 메시지 반환
   */
  static getInitializationError(): string | null {
    return initializationError;
  }

  /**
   * FCM 토큰 유효성 검증
   * Frontend Design Guideline: Single Responsibility - 토큰 검증만 담당
   */
  static validateToken(fcmToken: string): {
    isValid: boolean;
    reason?: string;
  } {
    if (!fcmToken || typeof fcmToken !== "string") {
      return { isValid: false, reason: "토큰이 비어있거나 문자열이 아닙니다" };
    }

    if (fcmToken.trim() === "") {
      return { isValid: false, reason: "토큰이 빈 문자열입니다" };
    }

    if (!isValidFCMToken(fcmToken)) {
      return { isValid: false, reason: "유효하지 않은 FCM 토큰 형식입니다" };
    }

    return { isValid: true };
  }

  /**
   * 개별 사용자에게 푸시 알림 전송
   * @param fcmToken FCM 토큰
   * @param title 알림 제목
   * @param body 알림 내용
   * @param data 추가 데이터
   * @param badgeCount iOS 뱃지 수
   */
  static async sendToDevice(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    badgeCount?: number
  ): Promise<boolean> {
    // Firebase 초기화 상태 확인
    if (!this.isAvailable()) {
      console.warn(
        "Firebase가 초기화되지 않아 푸시 알림을 전송할 수 없습니다:",
        initializationError
      );
      return false;
    }

    // FCM 토큰 유효성 검증
    const tokenValidation = this.validateToken(fcmToken);
    if (!tokenValidation.isValid) {
      console.warn(
        `❌ FCM 토큰 검증 실패 (${fcmToken.substring(0, 20)}...): ${
          tokenValidation.reason
        }`
      );
      return false;
    }

    const messaging = getMessaging();
    if (!messaging) {
      console.warn("Firebase Messaging 서비스를 사용할 수 없습니다.");
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          notification: {
            channelId: "high_importance_channel",
            priority: "high" as const,
            sound: "default",
          },
          priority: "high" as const,
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              badge: badgeCount || 0,
              sound: "default",
            },
          },
        },
      };

      const response = await messaging.send(message);
      console.log(
        `✅ FCM 메시지 전송 성공 (${fcmToken.substring(0, 20)}...):`,
        response
      );
      return true;
    } catch (error) {
      // 토큰 관련 에러를 구체적으로 로깅
      if (error instanceof Error) {
        if (error.message.includes("registration token")) {
          console.error(
            `❌ FCM 토큰 오류 (${fcmToken.substring(
              0,
              20
            )}...): 유효하지 않은 등록 토큰`
          );
        } else if (error.message.includes("not registered")) {
          console.error(
            `❌ FCM 토큰 오류 (${fcmToken.substring(
              0,
              20
            )}...): 등록되지 않은 토큰`
          );
        } else {
          console.error(
            `❌ FCM 메시지 전송 실패 (${fcmToken.substring(0, 20)}...):`,
            error.message
          );
        }
      } else {
        console.error(
          `❌ FCM 메시지 전송 실패 (${fcmToken.substring(0, 20)}...):`,
          error
        );
      }
      return false;
    }
  }

  /**
   * 다중 사용자에게 푸시 알림 전송
   * @param fcmTokens FCM 토큰 배열
   * @param title 알림 제목
   * @param body 알림 내용
   * @param data 추가 데이터
   * @param getUserBadgeCount 사용자별 뱃지 수 가져오는 함수
   */
  static async sendToMultipleDevices(
    fcmTokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    getUserBadgeCount?: (fcmToken: string) => Promise<number>
  ): Promise<{ success: number; failure: number; invalidTokens: string[] }> {
    if (!this.isAvailable()) {
      console.warn(
        "Firebase가 초기화되지 않아 푸시 알림을 전송할 수 없습니다:",
        initializationError
      );
      return {
        success: 0,
        failure: fcmTokens.length,
        invalidTokens: fcmTokens,
      };
    }

    let successCount = 0;
    let failureCount = 0;
    const invalidTokens: string[] = [];

    // 먼저 모든 토큰 검증
    const validTokens = fcmTokens.filter((token) => {
      const validation = this.validateToken(token);
      if (!validation.isValid) {
        invalidTokens.push(token);
        console.warn(
          `유효하지 않은 토큰 제외: ${token.substring(0, 20)}... - ${
            validation.reason
          }`
        );
        return false;
      }
      return true;
    });

    console.log(
      `📊 토큰 검증 결과: 총 ${fcmTokens.length}개 중 ${validTokens.length}개 유효, ${invalidTokens.length}개 무효`
    );

    // 유효한 토큰들에 대해서만 전송 시도
    const sendPromises = validTokens.map(async (token) => {
      try {
        const badgeCount = getUserBadgeCount
          ? await getUserBadgeCount(token)
          : 0;
        const success = await this.sendToDevice(
          token,
          title,
          body,
          data,
          badgeCount
        );
        return success;
      } catch (error) {
        console.error(
          `FCM 토큰 ${token.substring(0, 20)}... 전송 실패:`,
          error
        );
        return false;
      }
    });

    const results = await Promise.all(sendPromises);
    results.forEach((success) => {
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
    });

    // 유효하지 않은 토큰들도 실패 카운트에 추가
    failureCount += invalidTokens.length;

    console.log(
      `📊 FCM 전송 결과 - 성공: ${successCount}, 실패: ${failureCount}, 무효 토큰: ${invalidTokens.length}`
    );
    return { success: successCount, failure: failureCount, invalidTokens };
  }

  /**
   * 토픽 구독자들에게 푸시 알림 전송
   * @param topic 토픽명
   * @param title 알림 제목
   * @param body 알림 내용
   * @param data 추가 데이터
   */
  static async sendToTopic(
    topic: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn(
        "Firebase가 초기화되지 않아 토픽 알림을 전송할 수 없습니다:",
        initializationError
      );
      return false;
    }

    const messaging = getMessaging();
    if (!messaging) {
      console.warn("Firebase Messaging 서비스를 사용할 수 없습니다.");
      return false;
    }

    try {
      const message: admin.messaging.Message = {
        topic,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          notification: {
            channelId: "high_importance_channel",
            priority: "high" as const,
            sound: "default",
          },
          priority: "high" as const,
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: "default",
            },
          },
        },
      };

      const response = await messaging.send(message);
      console.log("✅ FCM 토픽 메시지 전송 성공:", response);
      return true;
    } catch (error) {
      console.error("❌ FCM 토픽 메시지 전송 실패:", error);
      return false;
    }
  }
}
