package payapi

import (
	"math/big"
	"testing"
)

func TestDecimalRoundTrip(t *testing.T) {
	cases := []struct{ in string }{
		{"1.00"}, {"0.001"}, {"1000000"}, {"0.000001"}, {"12.345678"}, {"0"},
	}
	for _, c := range cases {
		atomic, err := decimalToAtomic(c.in, 6)
		if err != nil {
			t.Fatalf("decimalToAtomic(%q): %v", c.in, err)
		}
		back := atomicToDecimal(atomic, 6)
		// "1.00" renders as "1.0" (trailing zeros trimmed); compare numerically.
		atomic2, err := decimalToAtomic(back, 6)
		if err != nil {
			t.Fatalf("decimalToAtomic(%q): %v", back, err)
		}
		if atomic2.Cmp(atomic) != 0 {
			t.Fatalf("round trip %q → %q", c.in, back)
		}
	}
}

func TestDecimalToAtomicErrors(t *testing.T) {
	for _, in := range []string{"", "abc", "1.0000001", "-", "1..2"} {
		if _, err := decimalToAtomic(in, 6); err == nil {
			t.Fatalf("expected error for %q", in)
		}
	}
}

func TestAtomicToDecimal(t *testing.T) {
	if got := atomicToDecimal(big.NewInt(1_000_000), 6); got != "1.0" {
		t.Fatalf("1e6 → %q", got)
	}
	if got := atomicToDecimal(big.NewInt(1), 6); got != "0.000001" {
		t.Fatalf("1 → %q", got)
	}
	if got := atomicToDecimal(new(big.Int).Neg(big.NewInt(5_000_000)), 6); got != "-5.0" {
		t.Fatalf("-5e6 → %q", got)
	}
}

func TestAccountName(t *testing.T) {
	// fingerprint base64url may contain '_' and '=' which are invalid in CDP
	// account names; they must be dropped and the result must match the
	// ^[A-Za-z0-9][A-Za-z0-9-]{0,34}[A-Za-z0-9]$ pattern.
	for _, fp := range []string{
		"aGVsbG9fd29ybGQ",
		"abcd-efgh-1234",
		"",
	} {
		name := accountName(fp)
		if len(name) < 2 || len(name) > 36 {
			t.Fatalf("accountName(%q) = %q length %d out of bounds", fp, name, len(name))
		}
		for _, ch := range name {
			ok := ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '-'
			if !ok {
				t.Fatalf("accountName(%q) = %q contains invalid char %q", fp, name, ch)
			}
		}
	}
}

func TestIsHexAddress(t *testing.T) {
	good := []string{
		"0x2e0c37b721124e2558baf75f6f8e6cc9f14aec29",
		"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	}
	for _, a := range good {
		if !isHexAddress(a) {
			t.Fatalf("%q should be a valid address", a)
		}
	}
	bad := []string{"0x1234", "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", "", "0x2e0c37b721124e2558baf75f6f8e6cc9f14aec2"}
	for _, a := range bad {
		if isHexAddress(a) {
			t.Fatalf("%q should be invalid", a)
		}
	}
}
