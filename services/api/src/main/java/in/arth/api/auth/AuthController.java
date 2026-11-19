package in.arth.api.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import in.arth.api.market.WatchlistService;
import in.arth.api.user.ConsentService;
import in.arth.api.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/auth")
class AuthController {

	private static final String INDIAN_MOBILE = "^\\+91[6-9]\\d{9}$";

	record OtpRequest(@NotBlank @Pattern(regexp = INDIAN_MOBILE, message = "must be an Indian mobile number in +91 format") String phone) {}

	record OtpVerify(
			@NotBlank @Pattern(regexp = INDIAN_MOBILE) String phone,
			@NotBlank @Pattern(regexp = "^\\d{6}$") String code) {}

	record RefreshRequest(@NotBlank String refreshToken) {}

	record SessionUser(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String phone, String name, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String locale, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean isNew, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Map<String, Boolean> consents) {}

	record Session(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accessToken, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) SessionUser user) {}

	record TokenPair(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String accessToken, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String refreshToken, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn) {}

	private final OtpService otp;
	private final TokenService tokens;
	private final UserRepository users;
	private final ConsentService consents;
	private final WatchlistService watchlists;

	AuthController(OtpService otp, TokenService tokens, UserRepository users, ConsentService consents, WatchlistService watchlists) {
		this.otp = otp;
		this.tokens = tokens;
		this.users = users;
		this.consents = consents;
		this.watchlists = watchlists;
	}

	@PostMapping("/otp/request")
	@ResponseStatus(HttpStatus.ACCEPTED)
	void requestOtp(@Valid @RequestBody OtpRequest body) {
		otp.request(body.phone());
	}

	@PostMapping("/otp/verify")
	@Transactional
	Session verify(@Valid @RequestBody OtpVerify body) {
		otp.verify(body.phone(), body.code());
		UserRepository.Upserted result = users.upsertByPhone(body.phone());
		UserRepository.User user = result.user();
		if (result.created()) {
			watchlists.createDefault(user.id());
		}
		TokenService.Tokens issued = tokens.issue(user.id());
		return new Session(issued.accessToken(), issued.refreshToken(), issued.expiresInSeconds(),
				new SessionUser(user.id(), user.phone(), user.name(), user.locale(), result.created(), consents.current(user.id())));
	}

	@PostMapping("/refresh")
	TokenPair refresh(@Valid @RequestBody RefreshRequest body) {
		TokenService.Tokens issued = tokens.refresh(body.refreshToken());
		return new TokenPair(issued.accessToken(), issued.refreshToken(), issued.expiresInSeconds());
	}

	@PostMapping("/logout")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void logout(@Valid @RequestBody RefreshRequest body) {
		tokens.revoke(body.refreshToken());
	}
}
