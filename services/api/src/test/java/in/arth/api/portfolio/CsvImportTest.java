package in.arth.api.portfolio;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class CsvImportTest {

	private static final LocalDate TODAY = LocalDate.parse("2026-11-19");
	private static final Function<String, Optional<String>> RESOLVE = s -> Set.of("TCS", "INFY", "RELIANCE").contains(s) ? Optional.of(s)
			: "INERELI00000".equals(s) ? Optional.of("RELIANCE") : Optional.empty();

	@Test
	void parsesRfc4180QuotingBomAndCrlf() {
		var rows = CsvImport.parse("﻿a,\"b,c\",\"say \"\"hi\"\"\"\r\n1,2,3\r\n\r\n");
		assertThat(rows).containsExactly(java.util.List.of("a", "b,c", "say \"hi\""), java.util.List.of("1", "2", "3"));
	}

	@Test
	void autoMapsAZerodhaTradebook() {
		String csv = """
				symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
				TCS,INETCSX00001,2025-04-01,NSE,EQ,EQ,buy,false,10.000000,3500.50,1,1,2025-04-01T10:00:00
				INFY-EQ,INEINFY00004,2025-04-02,NSE,EQ,EQ,sell,false,2,1500,2,2,2025-04-02T10:00:00
				""";
		var r = CsvImport.read(csv, null, RESOLVE, TODAY);
		assertThat(r.mapping()).containsEntry("symbol", "symbol").containsEntry("side", "trade_type").containsEntry("qty", "quantity")
				.containsEntry("price", "price").containsEntry("date", "trade_date");
		assertThat(r.issues()).isEmpty();
		assertThat(r.drafts()).hasSize(2);
		assertThat(r.drafts().get(1).symbol()).isEqualTo("INFY");
		assertThat(r.drafts().get(1).side()).isEqualTo(Txn.Side.SELL);
	}

	@Test
	void reportsBadRowsWithLineAndFieldAndKeepsGoodOnes() {
		String csv = """
				Scrip,Action,Units,Rate,Date
				INERELI00000,B,"1,000",2450.5,15-Mar-2025
				NOPE,B,1,1,15/03/2025
				TCS,hold,1,1,2025-03-15
				TCS,S,-1,1,2025-03-15
				TCS,S,1,abc,2099-01-01
				""";
		var r = CsvImport.read(csv, null, RESOLVE, TODAY);
		assertThat(r.drafts()).hasSize(1);
		assertThat(r.drafts().getFirst().symbol()).isEqualTo("RELIANCE");
		assertThat(r.drafts().getFirst().qty()).isEqualByComparingTo("1000");
		assertThat(r.issues()).extracting(i -> i.row() + ":" + i.field())
				.containsExactly("3:symbol", "4:side", "5:qty", "6:price", "6:date");
	}

	@Test
	void explicitMappingOverridesDetectionAndMissingColumnsAreReported() {
		String csv = "Stock,Kind,N,Px,When\nTCS,buy,1,100,01-02-2025\n";
		var missing = CsvImport.read(csv, null, RESOLVE, TODAY);
		assertThat(missing.issues()).extracting(i -> i.field()).contains("side", "qty", "price", "date");
		var mapped = CsvImport.read(csv, Map.of("side", "Kind", "qty", "N", "price", "Px", "date", "When"), RESOLVE, TODAY);
		assertThat(mapped.issues()).isEmpty();
		assertThat(mapped.drafts().getFirst().tradeDate()).isEqualTo(LocalDate.parse("2025-02-01"));
	}

	@Test
	void capsRows() {
		StringBuilder sb = new StringBuilder("symbol,side,qty,price,date\n");
		for (int i = 0; i <= CsvImport.MAX_ROWS; i++) {
			sb.append("TCS,buy,1,1,2025-01-01\n");
		}
		var r = CsvImport.read(sb.toString(), null, RESOLVE, TODAY);
		assertThat(r.drafts()).isEmpty();
		assertThat(r.issues().getFirst().message()).contains("More than");
	}
}
