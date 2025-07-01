import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { FCMService } from "../utils/firebase";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 알림 목록 조회 API
 * GET /api/notifications?page=1&page_size=20
 * @param request - NextRequest 객체
 * @returns 알림 목록
 */
export async function GET(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // 페이지네이션 파라미터
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("page_size") || "20");

  // 페이지 및 사이즈 유효성 검증
  if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
    return NextResponse.json(
      { error: "유효하지 않은 페이지 파라미터입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 페이징 처리를 위한 offset 계산
    const offset = (page - 1) * pageSize;

    // 알림 목록 조회 (최신순 정렬)
    const [notificationsRows] = await connection.query(
      `SELECT 
        id, title, message, type, created_at, is_read, 
        related_id, sender_id, sender_name
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [userId, pageSize, offset]
    );

    // 읽지 않은 알림 개수 조회
    const [unreadRows] = await connection.query(
      "SELECT COUNT(*) AS unread_count FROM notifications WHERE user_id = ? AND is_read = 0",
      [userId]
    );

    const unreadCount = (unreadRows as any[])[0].unread_count;

    connection.release();

    return NextResponse.json({
      success: true,
      notifications: notificationsRows,
      pagination: {
        page,
        page_size: pageSize,
        has_more: (notificationsRows as any[]).length === pageSize,
      },
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("알림 목록 조회 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "알림 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 알림 생성 API
 * POST /api/notifications
 * @param request - 요청 객체 (알림 데이터 포함)
 * @returns 성공 여부
 */
export async function POST(request: NextRequest) {
  // 인증 확인
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const payload = verifyJwt(token);
  const userId = payload?.id;

  // 요청 본문 파싱
  const body = await request.json();
  console.log("📥 알림 생성 API 요청:", body);

  // 알림 생성 요청 처리
  const { recipient_id, title, message, type, related_id } = body;

  // 필수 필드 유효성 검증
  if (!recipient_id || !title || !message || !type) {
    console.error("❌ 알림 생성 필수 필드 누락:", {
      recipient_id,
      title,
      message,
      type,
    });
    return NextResponse.json(
      { error: "recipient_id, title, message, type은 필수 항목입니다." },
      { status: 400 }
    );
  }

  // 타입 유효성 검증
  const validTypes = ["like", "comment", "reply", "testimony", "system"];
  if (!validTypes.includes(type)) {
    console.error("❌ 유효하지 않은 알림 타입:", type);
    return NextResponse.json(
      { error: "유효하지 않은 알림 타입입니다." },
      { status: 400 }
    );
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 수신자 존재 여부 확인
    const [userRows] = await connection.query(
      "SELECT id FROM users WHERE id = ?",
      [recipient_id]
    );

    if ((userRows as any[]).length === 0) {
      connection.release();
      console.error("❌ 존재하지 않는 수신자:", recipient_id);
      return NextResponse.json(
        { error: "존재하지 않는 수신자입니다." },
        { status: 404 }
      );
    }

    // 자기 자신에게 알림 생성 방지 (클라이언트에서도 체크하지만 서버에서도 체크)
    if (parseInt(recipient_id) === userId) {
      connection.release();
      console.log("ℹ️ 자기 자신에게 알림 생성 스킵");
      return NextResponse.json({
        success: true,
        message: "자기 자신에게는 알림을 보내지 않습니다.",
      });
    }

    // 발신자 정보 조회
    const [senderRows] = await connection.query(
      "SELECT id, name FROM users WHERE id = ?",
      [userId]
    );

    const senderName = (senderRows as any[])[0]?.name || "알 수 없는 사용자";

    // 알림 생성
    await connection.query(
      `INSERT INTO notifications 
       (user_id, title, message, type, related_id, sender_id, sender_name, is_read, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
      [
        recipient_id,
        title,
        message,
        type,
        related_id || null,
        userId,
        senderName,
      ]
    );

    // 수신자의 FCM 토큰 조회
    const [recipientRows] = await connection.query(
      "SELECT fcm_token FROM users WHERE id = ? AND fcm_token IS NOT NULL AND fcm_token != ''",
      [recipient_id]
    );

    // 수신자의 읽지 않은 알림 수 조회 (iOS 뱃지용)
    const [unreadCountRows] = await connection.query(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      [recipient_id]
    );
    const unreadCount = (unreadCountRows as any[])[0].count;

    connection.release();

    console.log("✅ 알림 생성 성공:", {
      recipient_id,
      sender: senderName,
      type,
      title,
    });

    // FCM 푸쉬 알림 전송 (백그라운드 작업으로 처리)
    if ((recipientRows as any[]).length > 0) {
      const recipientFcmToken = (recipientRows as any[])[0].fcm_token;

      // 백그라운드에서 푸쉬 알림 전송
      setImmediate(async () => {
        try {
          // Firebase 초기화 상태 확인
          if (!FCMService.isAvailable()) {
            console.warn(
              "⚠️  Firebase가 초기화되지 않았습니다. 푸쉬 알림을 건너뜁니다:",
              FCMService.getInitializationError()
            );
            return;
          }

          console.log(
            `📤 FCM 푸쉬 알림 전송 시작: ${recipientFcmToken.substring(
              0,
              20
            )}...`
          );

          // 알림 타입에 따른 추가 데이터 구성
          const notificationData: Record<string, string> = {
            type,
            action: "open_notification",
            sender_name: senderName,
          };

          // 관련 ID가 있는 경우 추가
          if (related_id) {
            notificationData.related_id = related_id;

            // 타입별 액션 설정
            if (type === "like" || type === "comment") {
              if (related_id.includes("testimony")) {
                notificationData.action = "open_testimony";
                notificationData.testimony_id = related_id;
              } else {
                notificationData.action = "open_notice";
                notificationData.notice_id = related_id;
              }
            }
          }

          const success = await FCMService.sendToDevice(
            recipientFcmToken,
            title,
            message,
            notificationData,
            unreadCount
          );

          if (success) {
            console.log(
              `✅ FCM 푸쉬 알림 전송 성공: ${recipientFcmToken.substring(
                0,
                20
              )}...`
            );
          } else {
            console.log(
              `❌ FCM 푸쉬 알림 전송 실패: ${recipientFcmToken.substring(
                0,
                20
              )}...`
            );
          }
        } catch (fcmError) {
          console.error("❌ FCM 전송 중 오류:", fcmError);
        }
      });

      console.log(
        `📨 알림 생성 완료 - 푸쉬 알림 전송 예약됨 (토큰: ${recipientFcmToken.substring(
          0,
          20
        )}...)`
      );
    } else {
      console.log(
        `ℹ️  수신자(${recipient_id})의 FCM 토큰이 없어 푸쉬 알림을 전송하지 않습니다.`
      );
    }

    return NextResponse.json({
      success: true,
      message: "알림이 생성되었습니다.",
    });
  } catch (error) {
    console.error("알림 생성 오류:", error);
    if (connection) connection.release();
    return NextResponse.json(
      { error: "알림 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
