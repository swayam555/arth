package in.arth.api.market;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class InstrumentRepository {

	private final JdbcClient jdbc;

	InstrumentRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** Ranks exact symbol, then symbol prefix, then name prefix, then trigram similarity. */
	List<Instrument> search(String query, String sector, int offset, int limit) {
		String q = query == null ? "" : query.trim();
		if (q.isEmpty()) {
			return jdbc.sql("SELECT " + Instrument.COLUMNS + " FROM instruments WHERE (?::text IS NULL OR sector = ?) ORDER BY symbol OFFSET ? LIMIT ?")
					.params(sector, sector, offset, limit)
					.query(Instrument::map)
					.list();
		}
		String upper = q.toUpperCase();
		String lower = q.toLowerCase();
		return jdbc.sql("""
				SELECT %s FROM instruments
				WHERE (?::text IS NULL OR sector = ?)
				  AND (symbol LIKE ? || '%%' OR lower(name) LIKE '%%' || ? || '%%' OR symbol %% ? OR lower(name) %% ?)
				ORDER BY CASE WHEN symbol = ? THEN 0 WHEN symbol LIKE ? || '%%' THEN 1 WHEN lower(name) LIKE ? || '%%' THEN 2 ELSE 3 END,
				         greatest(similarity(symbol, ?), similarity(lower(name), ?)) DESC,
				         mcap_bucket = 'large' DESC, symbol
				OFFSET ? LIMIT ?""".formatted(Instrument.COLUMNS))
				.params(sector, sector, upper, lower, upper, lower, upper, upper, lower, upper, lower, offset, limit)
				.query(Instrument::map)
				.list();
	}

	public Optional<Instrument> find(String symbol) {
		return jdbc.sql("SELECT " + Instrument.COLUMNS + " FROM instruments WHERE symbol = ?")
				.param(symbol)
				.query(Instrument::map)
				.optional();
	}

	public List<String> missing(Collection<String> symbols) {
		if (symbols.isEmpty()) {
			return List.of();
		}
		return jdbc.sql("SELECT s FROM unnest(?::text[]) AS s WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.symbol = s)")
				.param(symbols.toArray(String[]::new))
				.query(String.class)
				.list();
	}

	List<String> sectors() {
		return jdbc.sql("SELECT DISTINCT sector FROM instruments ORDER BY sector").query(String.class).list();
	}
}
