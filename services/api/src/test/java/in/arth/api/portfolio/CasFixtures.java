package in.arth.api.portfolio;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

/** Synthetic, password-protected CAS PDFs laid out like the real statements' text. */
public final class CasFixtures {

	public static final String PASSWORD = "ABCDE1234F";

	private CasFixtures() {}

	public static byte[] cdsl() {
		return pdf(List.of(
				"Central Depository Services (India) Limited",
				"Consolidated Account Statement",
				"Statement for the period from 01-10-2026 to 31-10-2026",
				"PAN: ABCDE1234F   Email: ramesh.k@example.com",
				"ISIN Security Name Current Bal Free Bal Market Price Value",
				"INETCSX00001 TATA CONSULTANCY SERVICES LTD 10.000 10.000 3,500.00 35,000.00",
				"INEINFY00004 INFOSYS LTD 25.000 25.000 1,500.00 37,500.00",
				"INEZZZZ99999 UNKNOWN CO LTD 1.000 1.000 10.00 10.00",
				"Portfolio Value 72,510.00"));
	}

	public static byte[] nsdl() {
		return pdf(List.of(
				"National Securities Depository Limited",
				"NSDL Consolidated Account Statement",
				"Summary of value of holdings as on 31-Oct-2026",
				"ISIN Description No. of Shares Market Price Value",
				"INERELI00000 RELIANCE INDUSTRIES LTD 4 2,900.00 11,600.00",
				"INESBIN00006 STATE BANK OF INDIA 10 800.00 9,000.00"));
	}

	public static byte[] cams() {
		return pdf(List.of(
				"Consolidated Account Statement",
				"Computer Age Management Services Limited (CAMS)",
				"01-Jan-2025 To 31-Oct-2026",
				"Email Id: ramesh.k@example.com",
				"PAN: ABCDE1234F",
				"NIFTYBEES - Nippon India ETF Nifty 50 BeES - ISIN: INENIFT00050",
				"Date Transaction Amount Units Price Unit Balance",
				"10-Jan-2025 Purchase - SIP 5,000.00 20.000 250.0000 20.000",
				"10-Feb-2025 Purchase - SIP 5,000.00 19.231 260.0000 39.231",
				"15-Mar-2025 Redemption (2,700.00) (10.000) 270.0000 29.231"));
	}

	public static byte[] unrelated() {
		return pdf(List.of("Electricity bill", "Amount due 1,234.00"));
	}

	static byte[] pdf(List<String> lines) {
		try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
			PDPage page = new PDPage();
			doc.addPage(page);
			try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
				cs.beginText();
				cs.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 9);
				cs.setLeading(14);
				cs.newLineAtOffset(36, 750);
				for (String line : lines) {
					cs.showText(line);
					cs.newLine();
				}
				cs.endText();
			}
			StandardProtectionPolicy policy = new StandardProtectionPolicy("owner-" + PASSWORD, PASSWORD, new AccessPermission());
			policy.setEncryptionKeyLength(256);
			doc.protect(policy);
			doc.save(out);
			return out.toByteArray();
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}
}
