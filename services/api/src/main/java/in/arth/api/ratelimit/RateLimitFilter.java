package in.arth.api.ratelimit;

import in.arth.api.config.ArthProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class RateLimitFilter extends OncePerRequestFilter {

	private final TokenBucket bucket;
	private final ArthProperties.RateLimit limits;

	RateLimitFilter(TokenBucket bucket, ArthProperties props) {
		this.bucket = bucket;
		this.limits = props.rateLimit();
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return request.getRequestURI().startsWith("/actuator");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		if (bucket.tryConsume(clientKey(request), limits.capacity(), limits.refillPerSecond())) {
			chain.doFilter(request, response);
			return;
		}
		response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
		response.setHeader("Retry-After", "1");
		response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		response.getWriter().write("{\"status\":429,\"title\":\"rate_limited\",\"code\":\"rate_limited\"}");
	}

	private static String clientKey(HttpServletRequest request) {
		var auth = SecurityContextHolder.getContext().getAuthentication();
		if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
			return "u:" + jwt.getSubject();
		}
		return "ip:" + request.getRemoteAddr();
	}
}
