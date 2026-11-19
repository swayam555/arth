package in.arth.api.market;

import in.arth.api.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/watchlists")
class WatchlistController {

	record NameBody(@NotBlank @Size(max = 40) String name) {}

	record ItemsBody(@NotNull @Size(max = WatchlistService.MAX_ITEMS) List<@NotBlank @Size(max = 20) String> symbols) {}

	record OrderBody(@NotNull @Size(max = WatchlistService.MAX_LISTS) List<@NotNull UUID> ids) {}

	private final WatchlistService watchlists;

	WatchlistController(WatchlistService watchlists) {
		this.watchlists = watchlists;
	}

	@GetMapping
	List<WatchlistService.Watchlist> list() {
		return watchlists.list(CurrentUser.id());
	}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	WatchlistService.Watchlist create(@Valid @RequestBody NameBody body) {
		return watchlists.create(CurrentUser.id(), body.name().trim());
	}

	@PatchMapping("/{id}")
	WatchlistService.Watchlist rename(@PathVariable UUID id, @Valid @RequestBody NameBody body) {
		return watchlists.rename(CurrentUser.id(), id, body.name().trim());
	}

	@DeleteMapping("/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable UUID id) {
		watchlists.delete(CurrentUser.id(), id);
	}

	@PutMapping("/{id}/items")
	WatchlistService.Watchlist items(@PathVariable UUID id, @Valid @RequestBody ItemsBody body) {
		return watchlists.replaceItems(CurrentUser.id(), id, body.symbols());
	}

	@PutMapping("/order")
	List<WatchlistService.Watchlist> order(@Valid @RequestBody OrderBody body) {
		return watchlists.reorder(CurrentUser.id(), body.ids());
	}
}
