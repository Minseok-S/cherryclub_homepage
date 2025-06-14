import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { FCMService } from "../utils/firebase";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 공지사항 목록 조회 API
 * GET /api/notices?page=1&page_size=10
 * @param request - NextRequest 객체
 * @returns 공지사항 목록
 */
export async function GET(request: NextRequest) {
  try {
    // 페이지네이션 파라미터
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("page_size") || "10");

    // 페이지 및 사이즈 유효성 검증
    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json(
        { error: "유효하지 않은 페이지 파라미터입니다." },
        { status: 400 }
      );
    }

    // 인증 확인 (선택적)
    const authHeader = request.headers.get(AUTH_HEADER);
    const token = authHeader?.split(" ")[1];
    const userId = token ? verifyJwt(token)?.id : null;

    const connection = await pool.getConnection();

    // 페이징 처리를 위한 offset 계산
    const offset = (page - 1) * pageSize;

    // 공지사항 목록 조회 (최신순 정렬)
    const [noticesRows] = await connection.query(
      `SELECT 
        n.id, n.title, LEFT(n.content, 200) AS content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        n.is_pinned,
        EXISTS(SELECT 1 FROM notice_likes WHERE notice_id = n.id AND user_id = ?) AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      ORDER BY n.is_pinned DESC, n.created_at DESC
      LIMIT ? OFFSET ?`,
      [userId || 0, pageSize, offset]
    );

    // 각 공지사항에 대한 이미지 조회
    const notices = [];
    for (const notice of noticesRows as any[]) {
      const [imageRows] = await connection.query(
        "SELECT image_url FROM notice_images WHERE notice_id = ?",
        [notice.id]
      );

      notices.push({
        ...notice,
        image_urls: (imageRows as any[]).map((img) => img.image_url),
        is_liked: !!notice.is_liked,
      });
    }

    connection.release();

    return NextResponse.json({
      success: true,
      notices,
      pagination: {
        page,
        page_size: pageSize,
        has_more: notices.length === pageSize,
      },
    });
  } catch (error) {
    console.error("공지사항 목록 조회 오류:", error);
    return NextResponse.json(
      { error: "공지사항 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 공지사항 생성 API
 * POST /api/notices
 * @param request - 요청 객체 (제목, 내용, 이미지 포함)
 * @returns 생성된 공지사항 정보
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

  // JSON 파싱 (Flutter에서 Firebase Storage URLs 전송)
  const body = await request.json();
  const { title, content, image_urls, is_pinned } = body;

  // 이미지 URLs (Firebase Storage에 이미 업로드된 상태)
  const imageUrls = image_urls || [];

  // 제목 및 내용 유효성 검증
  if (!title || !content) {
    return NextResponse.json(
      { error: "제목과 내용은 필수 항목입니다." },
      { status: 400 }
    );
  }

  let connection: any;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 공지사항 생성
    const [result] = await connection.query(
      "INSERT INTO notices (title, content, author_id, is_pinned) VALUES (?, ?, ?, ?)",
      [title, content, userId, is_pinned ? 1 : 0]
    );
    const noticeId = (result as any).insertId;

    // 이미지 URLs 처리 (Firebase Storage에 이미 업로드된 이미지들)
    if (imageUrls.length > 0) {
      for (const imageUrl of imageUrls) {
        // 이미지 URL을 notice_images 테이블에 저장
        await connection.query(
          "INSERT INTO notice_images (notice_id, image_url) VALUES (?, ?)",
          [noticeId, imageUrl]
        );
      }
    }

    // 생성된 공지사항 조회
    const [noticeRows] = await connection.query(
      `SELECT 
        n.id, n.title, n.content, 
        n.created_at, n.updated_at, 
        n.view_count, n.like_count, 
        (SELECT COUNT(*) FROM notice_comments WHERE notice_id = n.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        n.is_pinned,
        0 AS is_liked
      FROM notices n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE n.id = ?`,
      [noticeId]
    );

    // 이미지 조회
    const [imageRows] = await connection.query(
      "SELECT image_url FROM notice_images WHERE notice_id = ?",
      [noticeId]
    );

    await connection.commit();

    // 공지사항 객체 구성
    const notice = {
      ...(noticeRows as any[])[0],
      image_urls: (imageRows as any[]).map((img) => img.image_url),
      is_liked: false,
    };

    // FCM 토큰이 있는 모든 사용자에게 푸시 알림 전송
    try {
      // Firebase 초기화 상태 확인
      if (!FCMService.isAvailable()) {
        console.warn(
          "⚠️  Firebase가 초기화되지 않았습니다. 푸시 알림을 건너뜁니다:",
          FCMService.getInitializationError()
        );
        console.log(
          "✅ 공지사항은 정상적으로 생성되었습니다. (푸시 알림 제외)"
        );
        connection.release();
        return NextResponse.json({
          success: true,
          notice,
          warning: "Firebase 초기화 실패로 푸시 알림이 전송되지 않았습니다.",
        });
      }

      const [usersRows] = await connection.query(
        "SELECT id, fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''"
      );

      const users = usersRows as Array<{ id: string; fcm_token: string }>;

      if (users.length > 0) {
        // FCM 토큰 검증 및 디버깅
        console.log(`📊 데이터베이스에서 조회된 FCM 토큰: ${users.length}개`);

        const validTokenData: Array<{
          userId: string;
          fcmToken: string;
          badgeCount: number;
        }> = [];

        // 각 사용자에게 알림 DB 레코드 생성 및 뱃지 수 관리
        for (const user of users) {
          try {
            // FCM 토큰 유효성 검증
            const tokenValidation = FCMService.validateToken(user.fcm_token);
            if (!tokenValidation.isValid) {
              console.warn(
                `❌ 유효하지 않은 FCM 토큰 (User ${user.id}): ${
                  tokenValidation.reason
                } - 토큰: ${user.fcm_token.substring(0, 30)}...`
              );
              continue; // 유효하지 않은 토큰은 건너뛰기
            }

            // 알림 레코드 DB 저장
            await connection.query(
              `INSERT INTO notifications 
               (user_id, title, message, type, related_id, created_at, is_read) 
               VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
              [
                user.id,
                "새 공지사항",
                notice.title.length > 50
                  ? notice.title.substring(0, 50) + "..."
                  : notice.title,
                "notice",
                notice.id,
              ]
            );

            // 해당 사용자의 읽지 않은 알림 수 조회 (iOS 뱃지용)
            const [unreadCountRows] = await connection.query(
              "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
              [user.id]
            );
            const unreadCount = (unreadCountRows as any[])[0].count;

            validTokenData.push({
              userId: user.id,
              fcmToken: user.fcm_token,
              badgeCount: unreadCount,
            });
          } catch (notificationError) {
            console.error(
              `❌ 사용자 ${user.id} 알림 처리 실패:`,
              notificationError
            );
          }
        }

        console.log(
          `✅ 유효한 FCM 토큰: ${validTokenData.length}개 (총 ${users.length}개 중)`
        );

        if (validTokenData.length > 0) {
          // 푸시 알림 전송 (백그라운드 작업으로 처리)
          setImmediate(async () => {
            try {
              console.log(
                `📤 FCM 푸시 알림 전송 시작: ${validTokenData.length}개 토큰`
              );

              // 새로운 다중 전송 메서드 사용
              const result = await FCMService.sendToMultipleDevices(
                validTokenData.map((data) => data.fcmToken),
                "새 공지사항",
                notice.title.length > 100
                  ? notice.title.substring(0, 100) + "..."
                  : notice.title,
                {
                  type: "notice",
                  notice_id: notice.id.toString(),
                  action: "open_notice",
                },
                async (fcmToken: string) => {
                  // 해당 토큰의 뱃지 수 반환
                  const tokenData = validTokenData.find(
                    (data) => data.fcmToken === fcmToken
                  );
                  return tokenData?.badgeCount || 0;
                }
              );

              console.log(
                `✅ 공지사항 푸시 알림 전송 완료: 성공 ${result.success}개, 실패 ${result.failure}개, 무효 토큰 ${result.invalidTokens.length}개`
              );

              // 무효한 토큰들을 데이터베이스에서 정리 (선택적)
              if (result.invalidTokens.length > 0) {
                console.log(
                  `🧹 무효한 FCM 토큰 ${result.invalidTokens.length}개를 정리합니다.`
                );

                // 무효한 토큰들을 데이터베이스에서 NULL로 업데이트
                for (const invalidToken of result.invalidTokens) {
                  try {
                    const cleanupConnection = await pool.getConnection();
                    await cleanupConnection.query(
                      "UPDATE users SET fcm_token = NULL WHERE fcm_token = ?",
                      [invalidToken]
                    );
                    cleanupConnection.release();
                    console.log(
                      `🗑️  무효한 토큰 정리됨: ${invalidToken.substring(
                        0,
                        30
                      )}...`
                    );
                  } catch (cleanupError) {
                    console.error("토큰 정리 중 오류:", cleanupError);
                  }
                }
              }
            } catch (fcmError) {
              console.error("❌ FCM 전송 중 오류:", fcmError);
            }
          });

          console.log(
            `📨 공지사항 생성 - ${validTokenData.length}명의 사용자에게 유효한 알림 예약됨`
          );
        } else {
          console.log(
            "⚠️  유효한 FCM 토큰이 없어 푸시 알림을 전송하지 않습니다."
          );
        }
      } else {
        console.log("ℹ️  FCM 토큰이 등록된 사용자가 없습니다.");
      }
    } catch (notificationError) {
      console.error(
        "❌ 알림 처리 중 오류 (공지사항 생성은 성공):",
        notificationError
      );
      // 알림 처리 실패는 공지사항 생성 성공에 영향주지 않음
    }

    connection.release();

    return NextResponse.json({
      success: true,
      notice,
    });
  } catch (error) {
    console.error("공지사항 생성 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "공지사항 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
