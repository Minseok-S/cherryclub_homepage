import * as admin from "firebase-admin";

// Firebase 초기화 상태 추적
let isFirebaseInitialized = false;
let initializationError: string | null = null;

/**
 * 환경 변수 검증 함수
 * Frontend Design Guideline: Single Responsibility - 환경 변수 검증만 담당
 */
function validateFirebaseConfig() {
  const requiredVars = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_PRIVATE_KEY_ID",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_CLIENT_ID",
    "FIREBASE_CLIENT_X509_CERT_URL",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missingVars.join(", ")}`
    );
  }

  // private_key 특별 검증 (가장 중요한 값)
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!privateKey || privateKey.trim() === "") {
    throw new Error("FIREBASE_PRIVATE_KEY is empty or invalid");
  }

  return true;
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
    // 개발 환경에서 Firebase 환경 변수가 없는 경우 조기 종료
    if (
      process.env.NODE_ENV === "development" &&
      !process.env.FIREBASE_PROJECT_ID
    ) {
      console.log(
        "🔧 개발 환경에서 Firebase 환경 변수가 설정되지 않았습니다. Firebase 기능을 건너뜁니다."
      );
      isFirebaseInitialized = false;
      initializationError =
        "Development mode: Firebase environment variables not set";
      return false;
    }

    // 환경 변수 검증
    validateFirebaseConfig();

    // private_key 추가 처리
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
      // 이스케이프된 개행 문자를 실제 개행 문자로 변환
      privateKey = privateKey.replace(/\\n/g, "\n");

      // Base64로 인코딩된 경우 디코딩 (일부 호스팅 플랫폼에서 발생)
      if (!privateKey.includes("BEGIN PRIVATE KEY")) {
        try {
          privateKey = Buffer.from(privateKey, "base64").toString("utf8");
        } catch (e) {
          console.warn("Private key base64 디코딩 실패, 원본 값 사용");
        }
      }
    }

    // 서비스 계정 객체 구성
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID || "cherrymap-787ec",
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    };

    // Firebase Admin 앱이 이미 존재하는 경우 삭제
    if (admin.apps.length > 0) {
      admin.apps.forEach((app) => {
        try {
          app?.delete();
        } catch (e) {
          console.warn("기존 Firebase 앱 삭제 중 오류:", e);
        }
      });
    }

    // Firebase Admin SDK 초기화
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
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
        "🚨 프로덕션 환경에서 Firebase 초기화 실패! 환경 변수를 확인하세요."
      );
    } else {
      console.warn(
        "⚠️  개발 환경에서 Firebase 기능이 비활성화됩니다. 푸시 알림이 작동하지 않을 수 있습니다."
      );
      console.log(
        "💡 Firebase 설정 가이드: FIREBASE_SETUP.md 파일을 참고하세요."
      );
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
      console.log("✅ FCM 메시지 전송 성공:", response);
      return true;
    } catch (error) {
      console.error("❌ FCM 메시지 전송 실패:", error);
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
  ): Promise<{ success: number; failure: number }> {
    if (!this.isAvailable()) {
      console.warn(
        "Firebase가 초기화되지 않아 푸시 알림을 전송할 수 없습니다:",
        initializationError
      );
      return { success: 0, failure: fcmTokens.length };
    }

    let successCount = 0;
    let failureCount = 0;

    // 병렬 처리로 성능 최적화
    const sendPromises = fcmTokens.map(async (token) => {
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
        console.error(`FCM 토큰 ${token} 전송 실패:`, error);
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

    console.log(`FCM 전송 결과 - 성공: ${successCount}, 실패: ${failureCount}`);
    return { success: successCount, failure: failureCount };
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
