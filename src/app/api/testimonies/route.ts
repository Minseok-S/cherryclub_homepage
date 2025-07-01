import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { FCMService } from "../utils/firebase";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * 간증 목록 조회 API
 * GET /api/testimonies?page=1&page_size=10&category=campus
 * @param request - NextRequest 객체
 * @returns 간증 목록
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Predictability: 공지사항과 동일한 구조로 일관된 응답 형식
 * - Cohesion: 카테고리 관련 기능을 함께 관리
 */
export async function GET(request: NextRequest) {
  try {
    // 페이지네이션 및 필터링 파라미터
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("page_size") || "10");
    const category = searchParams.get("category"); // 카테고리 필터

    // 페이지 및 사이즈 유효성 검증
    if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
      return NextResponse.json(
        { error: "유효하지 않은 페이지 파라미터입니다." },
        { status: 400 }
      );
    }

    // 카테고리 유효성 검증 (Flutter와 동일한 값들)
    const validCategories = ["campus", "camp", "meeting", "etc"];
    if (category && !validCategories.includes(category)) {
      return NextResponse.json(
        { error: "유효하지 않은 카테고리입니다." },
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

    // 쿼리 조건 구성
    let whereClause = "";
    const queryParams: any[] = [userId || 0];

    if (category) {
      whereClause = "WHERE t.category = ?";
      queryParams.push(category);
    }

    // 간증 목록 조회 (HOT 게시글 우선 정렬, 카테고리 포함)
    // Frontend Design Guideline: Cohesion - HOT 게시글 로직과 일반 정렬을 함께 관리
    const [testimonyRows] = await connection.query(
      `SELECT 
        t.id, t.category, LEFT(t.content, 200) AS content, 
        t.created_at, t.updated_at, 
        t.view_count, t.like_count, 
        (SELECT COUNT(*) FROM testimony_comments WHERE testimony_id = t.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        EXISTS(SELECT 1 FROM testimony_likes WHERE testimony_id = t.id AND user_id = ?) AS is_liked,
        CASE 
          WHEN t.like_count >= 10 THEN 1 
          ELSE 0 
        END AS is_hot,
        CASE 
          WHEN t.like_count >= 10 AND DATEDIFF(NOW(), t.created_at) <= 7 THEN 1 
          ELSE 0 
        END AS is_top_hot
      FROM testimonies t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN t.like_count >= 10 AND DATEDIFF(NOW(), t.created_at) <= 7 THEN t.like_count 
          ELSE 0 
        END DESC,
        t.created_at DESC
      LIMIT ? OFFSET ?`,
      category
        ? [...queryParams, pageSize, offset]
        : [userId || 0, pageSize, offset]
    );

    // 각 간증에 대한 이미지 조회
    const testimonies = [];
    for (const testimony of testimonyRows as any[]) {
      const [imageRows] = await connection.query(
        "SELECT image_url FROM testimony_images WHERE testimony_id = ?",
        [testimony.id]
      );

      testimonies.push({
        ...testimony,
        image_urls: (imageRows as any[]).map((img) => img.image_url),
        is_liked: !!testimony.is_liked,
      });
    }

    connection.release();

    return NextResponse.json({
      success: true,
      testimonies,
      pagination: {
        page,
        page_size: pageSize,
        has_more: testimonies.length === pageSize,
      },
    });
  } catch (error) {
    console.error("간증 목록 조회 오류:", error);
    return NextResponse.json(
      { error: "간증 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 간증 생성 API
 * POST /api/testimonies
 * @param request - 요청 객체 (카테고리, 내용, 이미지 포함)
 * @returns 생성된 간증 정보
 *
 * @description
 * Frontend Design Guideline 적용:
 * - Single Responsibility: 간증 생성만 담당
 * - Predictability: 공지사항과 동일한 구조로 일관된 처리
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
  const { category, content, image_urls } = body;

  // 이미지 URLs (Firebase Storage에 이미 업로드된 상태)
  const imageUrls = image_urls || [];

  // 카테고리 및 내용 유효성 검증
  if (!category || !content) {
    return NextResponse.json(
      { error: "카테고리와 내용은 필수 항목입니다." },
      { status: 400 }
    );
  }

  // 카테고리 유효성 검증 (Flutter와 동일한 값들)
  const validCategories = ["campus", "camp", "meeting", "etc"];
  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { error: "유효하지 않은 카테고리입니다." },
      { status: 400 }
    );
  }

  let connection: any;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 간증 생성 (카테고리 포함)
    const [result] = await connection.query(
      "INSERT INTO testimonies (category, content, author_id) VALUES (?, ?, ?)",
      [category, content, userId]
    );
    const testimonyId = (result as any).insertId;

    // 이미지 URLs 처리 (Firebase Storage에 이미 업로드된 이미지들)
    if (imageUrls.length > 0) {
      for (const imageUrl of imageUrls) {
        // 이미지 URL을 testimony_images 테이블에 저장
        await connection.query(
          "INSERT INTO testimony_images (testimony_id, image_url) VALUES (?, ?)",
          [testimonyId, imageUrl]
        );
      }
    }

    // 생성된 간증 조회 (HOT 게시글 정보 포함)
    const [testimonyRows] = await connection.query(
      `SELECT 
        t.id, t.category, t.content, 
        t.created_at, t.updated_at, 
        t.view_count, t.like_count, 
        (SELECT COUNT(*) FROM testimony_comments WHERE testimony_id = t.id) AS comment_count,
        u.id AS author_id, u.name AS author_name,
        univ.name AS author_school,
        0 AS is_liked,
        CASE 
          WHEN t.like_count >= 10 AND DATEDIFF(NOW(), t.created_at) <= 7 THEN 1 
          ELSE 0 
        END AS is_hot
      FROM testimonies t
      JOIN users u ON t.author_id = u.id
      LEFT JOIN Universities univ ON u.universe_id = univ.id
      WHERE t.id = ?`,
      [testimonyId]
    );

    // 이미지 조회
    const [imageRows] = await connection.query(
      "SELECT image_url FROM testimony_images WHERE testimony_id = ?",
      [testimonyId]
    );

    await connection.commit();
    connection.release();

    // 간증 객체 구성
    const testimony = {
      ...(testimonyRows as any[])[0],
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
        console.log("✅ 간증이 정상적으로 생성되었습니다. (푸시 알림 제외)");
        return NextResponse.json({
          success: true,
          testimony,
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
                "새로운 간증이 도착했어요",
                testimony.content.length > 50
                  ? testimony.content.substring(0, 50) + "..."
                  : testimony.content,
                "testimony",
                testimony.id,
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
                "새로운 간증이 도착했어요",
                testimony.content.length > 100
                  ? testimony.content.substring(0, 100) + "..."
                  : testimony.content,
                {
                  type: "testimony",
                  testimony_id: testimony.id.toString(),
                  action: "open_testimony",
                  author_name: testimony.author_name,
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
                `✅ 간증 푸시 알림 전송 완료: 성공 ${result.success}개, 실패 ${result.failure}개, 무효 토큰 ${result.invalidTokens.length}개`
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
            `📨 간증 생성 - ${validTokenData.length}명의 사용자에게 유효한 알림 예약됨`
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
        "❌ 알림 처리 중 오류 (간증 생성은 성공):",
        notificationError
      );
      // 알림 처리 실패는 간증 생성 성공에 영향주지 않음
    }

    return NextResponse.json({
      success: true,
      testimony,
    });
  } catch (error) {
    console.error("간증 생성 오류:", error);
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    return NextResponse.json(
      { error: "간증 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
