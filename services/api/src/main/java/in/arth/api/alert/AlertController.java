package in.arth.api.alert;

import in.arth.api.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/alerts")
class AlertController {

	record CreateAlert(
			@NotBlank @Size(max = 20) String symbol,
			@NotNull AlertService.Kind kind,
			@NotNull @Positive @DecimalMax("10000000") BigDecimal value) {}

	record UpdateAlert(@Positive @DecimalMax("10000000") BigDecimal value, Boolean active) {}

	private final AlertService alerts;

	AlertController(AlertService alerts) {
		this.alerts = alerts;
	}

	@GetMapping
	List<AlertService.Alert> list() {
		return alerts.list(CurrentUser.id());
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	AlertService.Alert create(@Valid @RequestBody CreateAlert body) {
		return alerts.create(CurrentUser.id(), body.symbol(), body.kind(), body.value());
	}

	@PatchMapping("/{id}")
	AlertService.Alert update(@PathVariable UUID id, @Valid @RequestBody UpdateAlert body) {
		return alerts.update(CurrentUser.id(), id, Optional.ofNullable(body.value()), Optional.ofNullable(body.active()));
	}

	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable UUID id) {
		alerts.delete(CurrentUser.id(), id);
	}
}
