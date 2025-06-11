import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { pool } from "../../utils/db";
import { signJwt, generateRefreshToken } from "../../utils/jwt";
import { RowDataPacket } from "mysql2";

/**
 * 로그인 API
 * 전화번호(하이픈 유무 상관없음)와 비밀번호로 로그인합니다.
 * @param request - { phone: string, password: string } JSON body
 * @returns { success: true, user: { ... }, token: string, refreshToken: string } 또는 { error: string }
 * @example
 * fetch('/api/auth/login', {
 *   method: 'POST',
 *   body: JSON.stringify({ phone: '01000000000', password: 'pw1234' })
 * })
 *   .then(res => res.json())
 *   .then(data => {
 *     if (data.success) {
 *       localStorage.setItem('token', data.token);
 *       localStorage.setItem('refreshToken', data.refreshToken);
 *     }
 *   });
 */

export async function POST(request: Request) {
  try {
    const connection = await pool.getConnection();
    const data = await request.json();
    const { phone, password } = data;

    console.log(`로그인 시도: ${phone} (비밀번호 생략)`);

    if (!phone || !password) {
      connection.release();
      return NextResponse.json(
        { error: "전화번호와 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    // 입력값에서 숫자만 추출 (010-0000-0000, 01000000000 모두 지원)
    const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
    const inputPhone = normalizePhone(phone);
    console.log(`정규화된 전화번호: ${inputPhone}`);

    // DB에서 모든 유저의 phone을 가져와서 normalize 후 비교 (최적화 필요시 쿼리에서 처리 가능)
    console.log("사용자 정보 조회 중...");
    const [users] = await connection.query("SELECT * FROM users");
    console.log(`총 ${(users as any[]).length}명의 사용자가 조회됨`);

    const user = (users as any[]).find(
      (u) => normalizePhone(u.phone) === inputPhone
    );

    if (!user) {
      connection.release();
      console.log(`사용자를 찾을 수 없음: ${inputPhone}`);
      return NextResponse.json(
        { error: "등록되지 않은 전화번호입니다." },
        { status: 401 }
      );
    }

    console.log(`사용자 찾음: ID ${user.id}, 이름: ${user.name}`);

    // 비밀번호 비교
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      connection.release();
      console.log(`비밀번호 불일치: 사용자 ID ${user.id}`);
      return NextResponse.json(
        { error: "비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    console.log(`비밀번호 검증 성공: 사용자 ID ${user.id}`);

    // 로그인 성공 (user 정보에서 비밀번호 등 민감 정보 제외)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, universe_id, ...restUserInfo } = user;

    // universe_id로 university name 조회
    let universityName = null;
    if (universe_id) {
      const [univRows] = await connection.query<RowDataPacket[]>(
        "SELECT name FROM Universities WHERE id = ?",
        [universe_id]
      );
      if (univRows && univRows[0] && univRows[0].name) {
        universityName = univRows[0].name;
        console.log(`대학교 정보 조회: ${universityName}`);
      }
    }
    // region_group_id로 region, group_number 조회
    let region = null;
    let group_number = null;
    let restUserInfoWithoutRegionGroupId = { ...restUserInfo };
    if (
      typeof user.region_group_id !== "undefined" &&
      user.region_group_id !== null
    ) {
      const [regionRows] = await connection.query<RowDataPacket[]>(
        "SELECT region, group_number FROM region_groups WHERE id = ?",
        [user.region_group_id]
      );
      if (regionRows && regionRows[0]) {
        region = regionRows[0].region;
        group_number = regionRows[0].group_number;
        console.log(`지역 정보 조회: ${region}, 그룹: ${group_number}`);
      }
      const { ...rest } = restUserInfo;
      restUserInfoWithoutRegionGroupId = rest;
    }
    // userInfo에 university, region, group_number 필드 추가
    const userInfo = {
      ...restUserInfoWithoutRegionGroupId,
      university: universityName,
      region,
      group_number,
    };

    // JWT 토큰 발급 (id, role/authority 등 주요 정보 포함)
    const token = signJwt({ id: userInfo.id, role: userInfo.authority });
    console.log(
      `JWT 토큰 발급: 사용자 ID ${userInfo.id}, 권한 ${userInfo.authority}`
    );

    // 리프레시 토큰 발급 및 DB 저장
    const refreshToken = generateRefreshToken();
    console.log(`리프레시 토큰 발급: ${refreshToken.substring(0, 10)}...`);

    // 리프래시 토큰 만료시간 설정 (30일)
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(refreshTokenExpiresAt.getDate() + 30);

    console.log(
      `리프레시 토큰 DB 저장 중: 사용자 ID ${
        userInfo.id
      }, 만료시간: ${refreshTokenExpiresAt.toISOString()}`
    );
    const updateResult = await connection.query(
      "UPDATE users SET refresh_token = ?, refresh_token_expires_at = ? WHERE id = ?",
      [refreshToken, refreshTokenExpiresAt, userInfo.id]
    );
    console.log(`DB 업데이트 결과:`, updateResult[0]);

    // 업데이트 후 리프레시 토큰 확인 (디버깅)
    const [updatedUser] = await connection.query(
      "SELECT LEFT(refresh_token, 10) as token_prefix, refresh_token_expires_at FROM users WHERE id = ?",
      [userInfo.id]
    );

    console.log(
      `저장된 리프레시 토큰 확인 (앞 10자리):`,
      (updatedUser as any[])[0]
    );

    let leaderName = "";
    if (universe_id) {
      const [leaderRows] = await connection.query<RowDataPacket[]>(
        `SELECT MAX(CASE WHEN u.isCampusLeader = 1 THEN u.name ELSE NULL END) AS leader_name
         FROM Universities univ
         LEFT JOIN users u ON u.universe_id = univ.id
         WHERE univ.id = ?
         GROUP BY univ.id
         HAVING leader_name IS NOT NULL`,
        [universe_id]
      );
      const leaderRow = (leaderRows as RowDataPacket[])[0];
      if (leaderRow && leaderRow.leader_name) {
        leaderName = leaderRow.leader_name as string;
        console.log(`캠퍼스 리더: ${leaderName}`);
      }
    }

    connection.release();

    console.log(
      `로그인 성공: 사용자 ID ${userInfo.id}, 이름: ${userInfo.name}`
    );

    return NextResponse.json({
      success: true,
      user: userInfo,
      campus_leader: leaderName,
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("로그인 오류:", error);
    return NextResponse.json(
      { error: "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
