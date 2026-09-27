package meshcoreregion

import "testing"

func TestCatalogue(t *testing.T) {
	seen := map[string]bool{}
	counts := map[string]int{}
	for _, region := range All() {
		if seen[region.Token] || region.DisplayName == "" {
			t.Fatalf("invalid entry: %+v", region)
		}
		seen[region.Token] = true
		counts[region.Level]++
		if region.ParentToken != "" {
			parent, ok := Lookup(region.ParentToken)
			if !ok || (region.Level == "county" && parent.Level != "country") || (region.Level == "municipality" && parent.Level != "county") {
				t.Fatalf("invalid parent: %+v", region)
			}
		}
	}
	if counts["county"] != 21 || counts["municipality"] != 290 || len(seen) != 314 {
		t.Fatalf("unexpected catalogue size: %v", counts)
	}
	for token, name := range map[string]string{"se": "Sverige", "se06": "Jönköpings län", "#se0680": "Jönköpings kommun", "se2080": "Falu kommun", "se0880": "Kalmar kommun", "se0160": "Täby kommun", "*": "Utan angiven region"} {
		region, ok := Lookup(token)
		if !ok || region.DisplayName != name {
			t.Errorf("%s: got %+v, want %s", token, region, name)
		}
	}
	if _, ok := Lookup("JKG"); ok {
		t.Fatal("IATA must not be a MeshCore region")
	}
}
