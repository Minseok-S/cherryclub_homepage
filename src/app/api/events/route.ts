import { NextRequest, NextResponse } from "next/server";
import { pool } from "../utils/db";
import { verifyJwt } from "../utils/jwt";
import { FCMService } from "../utils/firebase";

// 인증 헤더 상수
const AUTH_HEADER = "authorization";

/**
 * @api events CRUD API
 * @description
 *  - POST: 이벤트 생성
 *  - GET: 이벤트 조회 (전체 또는 ID별)
 *  - PUT: 이벤트 수정
 *  - DELETE: 이벤트 삭제
 *  - JWT 인증 필요 (Authorization: Bearer ...)
 *
 * @test
 *  - 인증 없을 때 401 반환
 *  - POST/GET/PUT/DELETE 정상 동작
 *  - 필수값 누락 시 400 반환
 */

// 이벤트 생성 API
export async function POST(request: NextRequest) {
  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // 필수 필드 확인
    const requiredFields = [
      "title",
      "description",
      "start_date",
      "end_date",
      "start_time",
      "end_time",
      "category",
    ];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `필수 필드 누락: ${field}` },
          { status: 400 }
        );
      }
    }

    // JWT에서 userID 추출 (추가 정보로 사용 가능)
    const payload = verifyJwt(token);
    const userId = payload?.id;

    // 이벤트 저장 쿼리
    const query = `
      INSERT INTO events (
        title, description, start_date, end_date, start_time, end_time, location, category
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      body.title,
      body.description,
      body.start_date,
      body.end_date,
      body.start_time,
      body.end_time,
      body.location || null, // location은 선택 사항
      body.category,
    ];

    // DB 저장
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.query(query, params);
      const eventId = (result as any).insertId;

      // 생성된 이벤트 정보 조회 (알림 전송용)
      const [eventRows] = await connection.query(
        "SELECT * FROM events WHERE id = ?",
        [eventId]
      );
      const event = (eventRows as any[])[0];

      // FCM 토큰이 있는 모든 사용자에게 푸시 알림 전송
      try {
        // Firebase 초기화 상태 확인
        if (!FCMService.isAvailable()) {
          console.warn(
            "⚠️  Firebase가 초기화되지 않았습니다. 푸시 알림을 건너뜁니다:",
            FCMService.getInitializationError()
          );
          console.log("✅ 일정은 정상적으로 생성되었습니다. (푸시 알림 제외)");
          connection.release();
          return NextResponse.json({
            success: true,
            id: eventId,
            message: "이벤트가 성공적으로 생성되었습니다.",
            warning: "Firebase 초기화 실패로 푸시 알림이 전송되지 않았습니다.",
          });
        }

        const [usersRows] = await connection.query(
          "SELECT id, fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''"
        );

        const users = usersRows as Array<{ id: string; fcm_token: string }>;

        if (users.length > 0) {
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
                continue;
              }

              // 알림 레코드 DB 저장
              await connection.query(
                `INSERT INTO notifications 
                   (user_id, title, message, type, related_id, created_at, is_read) 
                   VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
                [
                  user.id,
                  "새로운 일정이 등록되었습니다",
                  event.title.length > 50
                    ? event.title.substring(0, 50) + "..."
                    : event.title,
                  "event",
                  event.id,
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

                const result = await FCMService.sendToMultipleDevices(
                  validTokenData.map((data) => data.fcmToken),
                  "새로운 일정이 등록되었습니다",
                  event.title.length > 100
                    ? event.title.substring(0, 100) + "..."
                    : event.title,
                  {
                    type: "event",
                    event_id: event.id.toString(),
                    action: "open_notification",
                    category: event.category,
                  },
                  async (fcmToken: string) => {
                    const tokenData = validTokenData.find(
                      (data) => data.fcmToken === fcmToken
                    );
                    return tokenData?.badgeCount || 0;
                  }
                );

                console.log(
                  `✅ 일정 푸시 알림 전송 완료: 성공 ${result.success}개, 실패 ${result.failure}개, 무효 토큰 ${result.invalidTokens.length}개`
                );
              } catch (fcmError) {
                console.error("❌ FCM 전송 중 오류:", fcmError);
              }
            });
          }
        }
      } catch (notificationError) {
        console.error(
          "❌ 알림 처리 중 오류 (일정 생성은 성공):",
          notificationError
        );
      }

      connection.release();
      return NextResponse.json({
        success: true,
        id: eventId,
        message: "이벤트가 성공적으로 생성되었습니다.",
      });
    } catch (error) {
      if (connection) connection.release();
      return NextResponse.json(
        { error: "DB 오류", detail: (error as any).message },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "요청 처리 중 오류 발생", detail: (error as any).message },
      { status: 400 }
    );
  }
}

// 이벤트 조회 API
export async function GET(request: NextRequest) {
  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
    // URL에서 id 파라미터 확인
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const category = searchParams.get("category");

    let query = "SELECT * FROM events";
    let params: any[] = [];

    // ID로 특정 이벤트 조회
    if (id) {
      query += " WHERE id = ?";
      params = [id];
    }
    // 카테고리로 필터링
    else if (category) {
      query += " WHERE category = ?";
      params = [category];
    }

    // 최신순 정렬
    query += " ORDER BY start_date DESC, start_time DESC";

    // DB 조회
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(query, params);
      connection.release();

      // 단일 이벤트 조회인 경우
      if (id && Array.isArray(rows) && rows.length === 0) {
        return NextResponse.json(
          { error: "이벤트를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      console.log(rows);

      return NextResponse.json({
        success: true,
        data: id && Array.isArray(rows) && rows.length > 0 ? rows[0] : rows,
      });
    } catch (error) {
      if (connection) connection.release();
      return NextResponse.json(
        { error: "DB 오류", detail: (error as any).message },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "요청 처리 중 오류 발생", detail: (error as any).message },
      { status: 400 }
    );
  }
}

// 이벤트 수정 API
export async function PUT(request: NextRequest) {
  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // 이벤트 ID 확인
    if (!body.id) {
      return NextResponse.json(
        { error: "이벤트 ID가 필요합니다." },
        { status: 400 }
      );
    }

    // 수정할 필드 목록 생성
    const updateFields = [];
    const params = [];

    // 수정 가능한 필드 목록
    const allowedFields = [
      "title",
      "description",
      "start_date",
      "end_date",
      "start_time",
      "end_time",
      "location",
      "category",
    ];

    // 수정할 필드와 값 설정
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        params.push(body[field]);
      }
    }

    // 수정할 필드가 없는 경우
    if (updateFields.length === 0) {
      return NextResponse.json(
        { error: "수정할 필드가 없습니다." },
        { status: 400 }
      );
    }

    // ID 파라미터 추가
    params.push(body.id);

    // 이벤트 수정 쿼리
    const query = `
      UPDATE events 
      SET ${updateFields.join(", ")} 
      WHERE id = ?
    `;

    // DB 업데이트
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.query(query, params);

      // 영향받은 행이 없는 경우 (ID가 존재하지 않음)
      if ((result as any).affectedRows === 0) {
        connection.release();
        return NextResponse.json(
          { error: "이벤트를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 수정된 이벤트 정보 조회 (알림 전송용)
      const [eventRows] = await connection.query(
        "SELECT * FROM events WHERE id = ?",
        [body.id]
      );
      const event = (eventRows as any[])[0];

      // FCM 토큰이 있는 모든 사용자에게 푸시 알림 전송
      try {
        // Firebase 초기화 상태 확인
        if (!FCMService.isAvailable()) {
          console.warn(
            "⚠️  Firebase가 초기화되지 않았습니다. 푸시 알림을 건너뜁니다:",
            FCMService.getInitializationError()
          );
          console.log("✅ 일정은 정상적으로 수정되었습니다. (푸시 알림 제외)");
          connection.release();
          return NextResponse.json({
            success: true,
            message: "이벤트가 성공적으로 수정되었습니다.",
            warning: "Firebase 초기화 실패로 푸시 알림이 전송되지 않았습니다.",
          });
        }

        const [usersRows] = await connection.query(
          "SELECT id, fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''"
        );

        const users = usersRows as Array<{ id: string; fcm_token: string }>;

        if (users.length > 0) {
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
                continue;
              }

              // 알림 레코드 DB 저장
              await connection.query(
                `INSERT INTO notifications 
                   (user_id, title, message, type, related_id, created_at, is_read) 
                   VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
                [
                  user.id,
                  "일정이 수정되었습니다",
                  event.title.length > 50
                    ? event.title.substring(0, 50) + "..."
                    : event.title,
                  "event",
                  event.id,
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

                const result = await FCMService.sendToMultipleDevices(
                  validTokenData.map((data) => data.fcmToken),
                  "일정이 수정되었습니다",
                  event.title.length > 100
                    ? event.title.substring(0, 100) + "..."
                    : event.title,
                  {
                    type: "event",
                    event_id: event.id.toString(),
                    action: "open_notification",
                    category: event.category,
                  },
                  async (fcmToken: string) => {
                    const tokenData = validTokenData.find(
                      (data) => data.fcmToken === fcmToken
                    );
                    return tokenData?.badgeCount || 0;
                  }
                );

                console.log(
                  `✅ 일정 푸시 알림 전송 완료: 성공 ${result.success}개, 실패 ${result.failure}개, 무효 토큰 ${result.invalidTokens.length}개`
                );
              } catch (fcmError) {
                console.error("❌ FCM 전송 중 오류:", fcmError);
              }
            });
          }
        }
      } catch (notificationError) {
        console.error(
          "❌ 알림 처리 중 오류 (일정 수정은 성공):",
          notificationError
        );
      }

      connection.release();
      return NextResponse.json({
        success: true,
        message: "이벤트가 성공적으로 수정되었습니다.",
      });
    } catch (error) {
      if (connection) connection.release();
      return NextResponse.json(
        { error: "DB 오류", detail: (error as any).message },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "요청 처리 중 오류 발생", detail: (error as any).message },
      { status: 400 }
    );
  }
}

// 이벤트 삭제 API
export async function DELETE(request: NextRequest) {
  // 인증 체크
  const authHeader = request.headers.get(AUTH_HEADER);
  const token = authHeader?.split(" ")[1];
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  }

  try {
    // URL에서 id 파라미터 확인
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    // ID 파라미터 필수
    if (!id) {
      return NextResponse.json(
        { error: "이벤트 ID가 필요합니다." },
        { status: 400 }
      );
    }

    // 이벤트 삭제 쿼리
    const query = "DELETE FROM events WHERE id = ?";

    // DB 삭제
    let connection;
    try {
      connection = await pool.getConnection();
      const [result] = await connection.query(query, [id]);
      connection.release();

      // 영향받은 행이 없는 경우 (ID가 존재하지 않음)
      if ((result as any).affectedRows === 0) {
        return NextResponse.json(
          { error: "이벤트를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "이벤트가 성공적으로 삭제되었습니다.",
      });
    } catch (error) {
      if (connection) connection.release();
      return NextResponse.json(
        { error: "DB 오류", detail: (error as any).message },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "요청 처리 중 오류 발생", detail: (error as any).message },
      { status: 400 }
    );
  }
}
