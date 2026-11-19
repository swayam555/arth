package in.arth.api.auth;

import in.arth.api.common.Hashing;
import in.arth.api.common.Problems;
import in.arth.api.config.ArthProperties;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TokenService {

	public record Tokens(String accessToken, String refreshToken, long expiresInSeconds) {}

	private record StoredToken(UUID id, UUID userId, UUID familyId, Instant expiresAt, Instant revokedAt) {}

	private final JwtEncoder encoder;
	private final JdbcClient jdbc;
	private final ArthProperties.Jwt config;

	TokenService(JwtEncoder encoder, JdbcClient jdbc, ArthProperties props) {
		this.encoder = encoder;
		this.jdbc = jdbc;
		this.config = props.jwt();
	}

	@Transactional
	public Tokens issue(UUID userId) {
		return issueInFamily(userId, UUID.randomUUID());
	}

	/**
	 * Rotates a refresh token. Presenting an already-rotated token means it leaked,
	 * so the whole family is revoked and the legitimate holder must log in again.
	 */
	@Transactional(noRollbackFor = org.springframework.web.ErrorResponseException.class)
	public Tokens refresh(String refreshToken) {
		StoredToken stored = jdbc.sql("""
				SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens
				WHERE token_hash = ? FOR UPDATE""")
				.param(Hashing.sha256(refreshToken))
				.query((rs, n) -> new StoredToken(
						rs.getObject("id", UUID.class),
						rs.getObject("user_id", UUID.class),
						rs.getObject("family_id", UUID.class),
						rs.getTimestamp("expires_at").toInstant(),
						rs.getTimestamp("revoked_at") == null ? null : rs.getTimestamp("revoked_at").toInstant()))
				.optional()
				.orElseThrow(() -> Problems.unauthorized("invalid_refresh", "Unknown refresh token"));

		if (stored.revokedAt() != null) {
			revokeFamily(stored.familyId());
			throw Problems.unauthorized("refresh_reused", "Refresh token reuse detected; session revoked");
		}
		if (stored.expiresAt().isBefore(Instant.now())) {
			throw Problems.unauthorized("refresh_expired", "Refresh token expired");
		}
		jdbc.sql("UPDATE refresh_tokens SET revoked_at = now() WHERE id = ?").param(stored.id()).update();
		return issueInFamily(stored.userId(), stored.familyId());
	}

	@Transactional
	public void revoke(String refreshToken) {
		jdbc.sql("""
				UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now())
				WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = ?)""")
				.param(Hashing.sha256(refreshToken))
				.update();
	}

	private void revokeFamily(UUID familyId) {
		jdbc.sql("UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = ?")
				.param(familyId)
				.update();
	}

	private Tokens issueInFamily(UUID userId, UUID familyId) {
		Instant now = Instant.now();
		JwtClaimsSet claims = JwtClaimsSet.builder()
				.issuer(config.issuer())
				.subject(userId.toString())
				.issuedAt(now)
				.expiresAt(now.plus(config.accessTtl()))
				.build();
		String access = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
				.getTokenValue();

		String refresh = Hashing.randomToken(32);
		jdbc.sql("INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
				.params(userId, familyId, Hashing.sha256(refresh), Timestamp.from(now.plus(config.refreshTtl())))
				.update();
		return new Tokens(access, refresh, config.accessTtl().toSeconds());
	}
}
