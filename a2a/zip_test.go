package a2a

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// unzipEntries opens raw zip bytes and returns an entry-name→content map (for assertions).
func unzipEntries(t *testing.T, raw []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("failed to open zip: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("failed to open zip entry %s: %v", f.Name, err)
		}
		var b bytes.Buffer
		if _, err := b.ReadFrom(rc); err != nil {
			t.Fatalf("failed to read zip entry %s: %v", f.Name, err)
		}
		rc.Close()
		out[f.Name] = b.String()
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// Multi-file directory → the zip contains all files (including subdirectories, relative structure preserved).
func TestZipArtifactDir_MultiFile(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "a.txt"), "AAA")
	mustWrite(t, filepath.Join(dir, "b.md"), "BBB")
	mustWrite(t, filepath.Join(dir, "sub", "c.json"), "CCC")

	raw, ok, err := ZipArtifactDir(dir)
	if err != nil {
		t.Fatalf("packing failed: %v", err)
	}
	if !ok {
		t.Fatal("multi-file directory should return ok=true")
	}
	entries := unzipEntries(t, raw)
	want := map[string]string{"a.txt": "AAA", "b.md": "BBB", "sub/c.json": "CCC"}
	if len(entries) != len(want) {
		t.Fatalf("zip should contain %d files, got %d: %v", len(want), len(entries), sortedKeys(entries))
	}
	for name, content := range want {
		got, ok := entries[name]
		if !ok {
			t.Errorf("zip is missing file %s", name)
			continue
		}
		if got != content {
			t.Errorf("file %s content = %q, want %q", name, got, content)
		}
	}
}

// Single-file directory → zipped too ("zip everything" policy).
func TestZipArtifactDir_SingleFile(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "only.txt"), "ONLY")

	raw, ok, err := ZipArtifactDir(dir)
	if err != nil {
		t.Fatalf("packing failed: %v", err)
	}
	if !ok {
		t.Fatal("single-file directory should return ok=true")
	}
	entries := unzipEntries(t, raw)
	if len(entries) != 1 || entries["only.txt"] != "ONLY" {
		t.Fatalf("single-file zip content is wrong: %v", entries)
	}
}

// Empty directory → ok=false (the caller falls back to text-only delivery).
func TestZipArtifactDir_Empty(t *testing.T) {
	dir := t.TempDir()
	raw, ok, err := ZipArtifactDir(dir)
	if err != nil {
		t.Fatalf("empty directory should not error: %v", err)
	}
	if ok {
		t.Fatal("empty directory should return ok=false")
	}
	if raw != nil {
		t.Fatalf("empty directory should return nil bytes, got %d bytes", len(raw))
	}
}

// A directory containing only empty files would also count as "nothing to pack" → ok=false.
func TestZipArtifactDir_OnlyEmptyFiles(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "empty1.txt"), "")
	mustWrite(t, filepath.Join(dir, "sub", "empty2.txt"), "")
	// Note: empty files are still regular files and get collected into the zip (n>0), so ok=true with empty content.
	raw, ok, err := ZipArtifactDir(dir)
	if err != nil {
		t.Fatalf("should not error: %v", err)
	}
	if !ok {
		t.Fatal("a directory with empty files still has entries, should be ok=true")
	}
	entries := unzipEntries(t, raw)
	if len(entries) != 2 {
		t.Fatalf("should contain 2 (empty) file entries, got %d", len(entries))
	}
}

// ZipArtifactPath: a single file path → zipped into an archive containing only that file.
func TestZipArtifactPath_SingleFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "report.pdf")
	mustWrite(t, fp, "PDFDATA")

	raw, ok, err := ZipArtifactPath(fp)
	if err != nil {
		t.Fatalf("packing single file failed: %v", err)
	}
	if !ok {
		t.Fatal("single file should be ok=true")
	}
	entries := unzipEntries(t, raw)
	if len(entries) != 1 || entries["report.pdf"] != "PDFDATA" {
		t.Fatalf("single-file zip content is wrong: %v", entries)
	}
}

// ZipArtifactPath: a directory path → packs every file in the directory.
func TestZipArtifactPath_Dir(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "x.txt"), "X")
	mustWrite(t, filepath.Join(dir, "y.txt"), "Y")

	raw, ok, err := ZipArtifactPath(dir)
	if err != nil {
		t.Fatalf("packing directory failed: %v", err)
	}
	if !ok {
		t.Fatal("non-empty directory should be ok=true")
	}
	entries := unzipEntries(t, raw)
	if len(entries) != 2 {
		t.Fatalf("should contain 2 files, got %d: %v", len(entries), sortedKeys(entries))
	}
}

// ZipArtifactPath: empty file → ok=false.
func TestZipArtifactPath_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "empty.txt")
	mustWrite(t, fp, "")
	_, ok, err := ZipArtifactPath(fp)
	if err != nil {
		t.Fatalf("should not error: %v", err)
	}
	if ok {
		t.Fatal("empty file should be ok=false")
	}
}

// ZipArtifactPath: non-existent path → error.
func TestZipArtifactPath_NotExist(t *testing.T) {
	_, ok, err := ZipArtifactPath(filepath.Join(t.TempDir(), "nope"))
	if err == nil {
		t.Fatal("non-existent path should error")
	}
	if ok {
		t.Fatal("non-existent path should be ok=false")
	}
}

func TestDeliveryZipName(t *testing.T) {
	if got := DeliveryZipName("m-001"); got != "交付物-m-001.zip" {
		t.Fatalf("DeliveryZipName = %q", got)
	}
	// Empty missionID fallback.
	if got := DeliveryZipName(""); got != "交付物-delivery.zip" {
		t.Fatalf("empty missionID fallback = %q", got)
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
