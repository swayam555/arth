package in.arth.api.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponseException;

public final class Problems {

	private Problems() {}

	public static ErrorResponseException of(HttpStatus status, String code, String detail) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
		problem.setTitle(code);
		problem.setProperty("code", code);
		return new ErrorResponseException(status, problem, null);
	}

	public static ErrorResponseException badRequest(String code, String detail) {
		return of(HttpStatus.BAD_REQUEST, code, detail);
	}

	public static ErrorResponseException unauthorized(String code, String detail) {
		return of(HttpStatus.UNAUTHORIZED, code, detail);
	}

	public static ErrorResponseException notFound(String what) {
		return of(HttpStatus.NOT_FOUND, "not_found", what + " not found");
	}

	public static ErrorResponseException tooManyRequests(String detail) {
		return of(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", detail);
	}

	public static ErrorResponseException conflict(String code, String detail) {
		return of(HttpStatus.CONFLICT, code, detail);
	}
}
