fn main() {
  println!("cargo:rerun-if-env-changed=JINGLING_QA_FEATURES");
  tauri_build::build()
}
