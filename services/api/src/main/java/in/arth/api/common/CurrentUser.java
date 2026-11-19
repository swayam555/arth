package in.arth.api.common;

import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

public final class CurrentUser {

	private CurrentUser() {}

	public static UUID id() {
		var auth = SecurityContextHolder.getContext().getAuthentication();
		if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
			return UUID.fromString(jwt.getSubject());
		}
		throw Problems.unauthorized("unauthenticated", "Missing access token");
	}
}
