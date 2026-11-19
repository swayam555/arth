package in.arth.api.user;

import io.swagger.v3.oas.annotations.media.Schema;
import in.arth.api.common.CurrentUser;
import in.arth.api.common.Events;
import in.arth.api.common.Problems;
import in.arth.proto.v1.UserDeleted;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/me")
class MeController {

	record Me(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String phone, String name, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String locale, @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Map<String, Boolean> consents) {}

	record UpdateMe(@Size(max = 80) String name, @Pattern(regexp = "^(en|hi)$") String locale) {}

	record UnregisterDevice(@NotBlank @Size(max = 200) String expoPushToken) {}

	record RegisterDevice(@NotBlank @Size(max = 200) String expoPushToken, @Pattern(regexp = "^(android|ios)$") String platform) {}

	private final UserRepository users;
	private final ConsentService consents;
	private final UserDataExporter exporter;
	private final JdbcClient jdbc;
	private final Events events;

	MeController(UserRepository users, ConsentService consents, UserDataExporter exporter, JdbcClient jdbc, Events events) {
		this.users = users;
		this.consents = consents;
		this.exporter = exporter;
		this.jdbc = jdbc;
		this.events = events;
	}

	@GetMapping
	Me me() {
		UUID id = CurrentUser.id();
		UserRepository.User user = users.find(id).orElseThrow(() -> Problems.notFound("User"));
		return new Me(user.id(), user.phone(), user.name(), user.locale(), consents.current(id));
	}

	@PatchMapping
	Me update(@Valid @RequestBody UpdateMe body) {
		users.update(CurrentUser.id(), body.name(), body.locale());
		return me();
	}

	@GetMapping("/consents")
	Map<String, Boolean> getConsents() {
		return consents.current(CurrentUser.id());
	}

	@PutMapping("/consents")
	Map<String, Boolean> putConsents(@RequestBody Map<String, Boolean> decisions) {
		return consents.record(CurrentUser.id(), decisions);
	}

	@PostMapping("/devices")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void registerDevice(@Valid @RequestBody RegisterDevice body) {
		jdbc.sql("""
				INSERT INTO devices (user_id, expo_push_token, platform) VALUES (?, ?, ?)
				ON CONFLICT (user_id, expo_push_token) DO UPDATE SET last_seen_at = now()""")
				.params(CurrentUser.id(), body.expoPushToken(), body.platform())
				.update();
	}

	@PostMapping("/devices/unregister")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void unregisterDevice(@Valid @RequestBody UnregisterDevice body) {
		jdbc.sql("DELETE FROM devices WHERE user_id = ? AND expo_push_token = ?")
				.params(CurrentUser.id(), body.expoPushToken())
				.update();
	}

	@GetMapping("/export")
	ResponseEntity<Map<String, Object>> export() {
		return ResponseEntity.ok()
				.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"arth-export.json\"")
				.body(exporter.export(CurrentUser.id()));
	}

	@DeleteMapping
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@Transactional
	void deleteMe() {
		UUID id = CurrentUser.id();
		users.delete(id);
		events.publish(Events.USER_DELETED, id.toString(),
				UserDeleted.newBuilder().setUserId(id.toString()).setTsMs(System.currentTimeMillis()).build());
	}
}
