// Included in runner::tests to reuse the real coordinator and its test app/database.
struct MaterialProvider {
    calls: AtomicUsize,
    seen: Mutex<Vec<String>>,
    block_call: Option<usize>,
    bad_quote: bool,
    started: tokio::sync::Notify,
}
impl MaterialProvider {
    fn new(block_call: Option<usize>) -> Self {
        Self {
            calls: AtomicUsize::new(0),
            seen: Mutex::new(Vec::new()),
            block_call,
            bad_quote: false,
            started: tokio::sync::Notify::new(),
        }
    }
}
#[async_trait]
impl<R: Runtime> AgentTextGenerator<R> for MaterialProvider {
    async fn generate(
        &self,
        _app: &AppHandle<R>,
        _session: &str,
        _task: Option<&str>,
        instruction: &str,
        untrusted: Option<&str>,
        token: CancellationToken,
    ) -> Result<AgentGenerateOutcome, String> {
        let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        let raw = untrusted.unwrap();
        self.seen.lock().unwrap().push(raw.into());
        if self.block_call == Some(n) {
            self.started.notify_one();
            token.cancelled().await;
            return Ok(AgentGenerateOutcome::Cancelled);
        }
        let data: Value = serde_json::from_str(raw).unwrap();
        let source = if instruction.starts_with("Extract this one") {
            &data
        } else {
            &data["sources"][0]
        };
        let quote = if self.bad_quote {
            "NONEXISTENT QUOTATION".to_string()
        } else {
            source["fragments"][0]["text"]
                .as_str()
                .unwrap()
                .chars()
                .take(16)
                .collect::<String>()
        };
        let reference = json!({"fragmentId":"f1","quote":quote});
        let output = if instruction.starts_with("Extract this one") {
            json!({"answer":"Selected source points.","insufficient":false,"references":[reference]})
        } else {
            let mut citation = reference;
            citation["sourceId"] = json!("s1");
            json!({"overview":"A report about the selected materials.","analysis":[{"kind":"source_fact","text":"The source states a price.","references":[citation]}],"gaps":["The owner still needs confirmation."]})
        };
        Ok(AgentGenerateOutcome::Done(output.to_string()))
    }
}

fn seed_material_run<R: Runtime>(app: &AppHandle<R>) -> (String, String) {
    let db = app.state::<Db>();
    let mut conn = db.0.lock().unwrap();
    for (id, text) in [
        ("n1", "Alpha costs 120. Starts in May."),
        ("n2", "Beta takes four weeks. Owner unknown."),
        ("unselected", "PRIVATE UNSELECTED MATERIAL"),
    ] {
        upsert_record(&conn,"assets_notes",&json!({"id":id,"title":id,"text":text,"updated":1,"extraPrivate":"PRIVATE NON-TEXT FIELD"})).unwrap();
    }
    let mut task=super::super::normalize_task_draft(json!({"workflowId":"material_report","goal":"Compare the selected notes","inputs":{"materials":[{"kind":"note","id":"n1","updated":1},{"kind":"note","id":"n2","updated":1}],"language":"en"}}),now_ms()).unwrap();
    material::freeze(&conn, &mut task).unwrap();
    upsert_record(&conn, TASKS, &task).unwrap();
    let run = prepare_new_run(&mut conn, &task).unwrap();
    (value_id(&task), value_id(&run))
}

#[tokio::test]
async fn material_workflow_writes_two_real_files_from_checked_snapshots() {
    let root = test_root("material-success");
    let app = test_app(root.clone());
    let handle = app.handle().clone();
    let (task_id, run_id) = seed_material_run(&handle);
    let provider = MaterialProvider::new(None);
    execute_run_with(&handle, &run_id, &RunControl::new(), &provider)
        .await
        .unwrap();
    let db = handle.state::<Db>();
    let conn = db.0.lock().unwrap();
    assert_eq!(
        get_record(&conn, RUNS, &run_id).unwrap().unwrap()["status"],
        "succeeded"
    );
    assert_eq!(ordered_steps(&conn, &run_id).unwrap().len(), 7);
    let records = related(&conn, ARTIFACTS, "runId", &run_id).unwrap();
    assert_eq!(records.len(), 2);
    assert!(records.iter().all(|r| r["verified"] == true));
    let task = get_record(&conn, TASKS, &task_id).unwrap().unwrap();
    verify_material_run(&conn, &root, &task, &run_id, &records).unwrap();
    let md = std::fs::read_to_string(root.join(&task_id).join(&run_id).join("material-report.md"))
        .unwrap();
    assert!(md.contains("Source fact"));
    assert!(md.contains("Gaps and open questions"));
    assert!(md.contains("Alpha costs 120"));
    assert!(!md.contains("PRIVATE"));
    let bytes = std::fs::read(
        root.join(&task_id)
            .join(&run_id)
            .join("material-report.docx"),
    )
    .unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    std::io::Read::read_to_string(&mut zip.by_name("word/document.xml").unwrap(), &mut xml)
        .unwrap();
    assert!(xml.contains("Alpha costs 120"));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 3);
    for request in provider.seen.lock().unwrap().iter() {
        assert!(!request.contains("PRIVATE"));
    }
    assert!(!provider.seen.lock().unwrap()[0].contains("Beta takes"));
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn material_pause_resume_preserves_completed_source_and_never_rereads_live_notes() {
    let root = test_root("material-resume");
    let app = test_app(root.clone());
    let handle = app.handle().clone();
    let (_, run_id) = seed_material_run(&handle);
    let provider = MaterialProvider::new(Some(2));
    let control = RunControl::new();
    let (result, _) = tokio::join!(
        execute_run_with(&handle, &run_id, &control, &provider),
        async {
            provider.started.notified().await;
            control.request(REQUEST_PAUSE);
        }
    );
    result.unwrap();
    {
        let db = handle.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert_eq!(
            step_by_key(&conn, &run_id, "extract_material_1").unwrap()["status"],
            "succeeded"
        );
        assert_eq!(
            get_record(&conn, RUNS, &run_id).unwrap().unwrap()["status"],
            "paused"
        );
        conn.execute("DELETE FROM assets_notes", []).unwrap();
    }
    let db = handle.state::<Db>();
    let runs = handle.state::<AgentRuns>();
    let control = initialize_resume(&handle, &db, &runs, &run_id).unwrap();
    execute_run_with(&handle, &run_id, &control, &provider)
        .await
        .unwrap();
    release_run(&runs, &run_id);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 4);
    assert_eq!(
        get_record(&db.0.lock().unwrap(), RUNS, &run_id)
            .unwrap()
            .unwrap()["status"],
        "succeeded"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn material_write_failure_recovers_without_repeating_model_steps() {
    let root = test_root("material-write-failure");
    let app = test_app(root.clone());
    let handle = app.handle().clone();
    let (_, run_id) = seed_material_run(&handle);
    let provider = MaterialProvider::new(None);
    handle
        .state::<artifact::TestArtifactFault>()
        .0
        .store(2, Ordering::SeqCst);
    execute_run_with(&handle, &run_id, &RunControl::new(), &provider)
        .await
        .unwrap();
    {
        let db = handle.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert_eq!(
            step_by_key(&conn, &run_id, "write_material_report").unwrap()["status"],
            "outcome_unknown"
        );
        assert!(related(&conn, ARTIFACTS, "runId", &run_id)
            .unwrap()
            .is_empty());
    }
    handle
        .state::<artifact::TestArtifactFault>()
        .0
        .store(0, Ordering::SeqCst);
    let db = handle.state::<Db>();
    let runs = handle.state::<AgentRuns>();
    let control = initialize_resume(&handle, &db, &runs, &run_id).unwrap();
    execute_run_with(&handle, &run_id, &control, &provider)
        .await
        .unwrap();
    release_run(&runs, &run_id);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        get_record(&db.0.lock().unwrap(), RUNS, &run_id)
            .unwrap()
            .unwrap()["status"],
        "succeeded"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn material_rejects_wrong_quotes_and_modified_plans_before_writing() {
    for tamper_plan in [false, true] {
        let root = test_root(if tamper_plan {
            "material-plan"
        } else {
            "material-quotes"
        });
        let app = test_app(root.clone());
        let handle = app.handle().clone();
        let (_, run_id) = seed_material_run(&handle);
        let mut provider = MaterialProvider::new(None);
        provider.bad_quote = true;
        if tamper_plan {
            let db = handle.state::<Db>();
            let conn = db.0.lock().unwrap();
            let step = step_by_key(&conn, &run_id, "extract_material_1").unwrap();
            update_record(
                &conn,
                STEPS,
                &value_id(&step),
                &[("tool", json!("arbitrary_shell"))],
            )
            .unwrap();
        }
        let result = execute_run_with(&handle, &run_id, &RunControl::new(), &provider).await;
        assert_eq!(result.is_err(), tamper_plan);
        let db = handle.state::<Db>();
        let conn = db.0.lock().unwrap();
        assert_ne!(
            get_record(&conn, RUNS, &run_id).unwrap().unwrap()["status"],
            "succeeded"
        );
        assert!(related(&conn, ARTIFACTS, "runId", &run_id)
            .unwrap()
            .is_empty());
        assert_eq!(
            provider.calls.load(Ordering::SeqCst),
            if tamper_plan { 0 } else { 1 }
        );
    }
}

#[tokio::test]
async fn material_cancel_keeps_completed_extraction_and_requires_a_new_task() {
    let root = test_root("material-cancel");
    let app = test_app(root.clone());
    let handle = app.handle().clone();
    let (task_id, run_id) = seed_material_run(&handle);
    let provider = MaterialProvider::new(Some(2));
    let control = RunControl::new();
    let (result, _) = tokio::join!(
        execute_run_with(&handle, &run_id, &control, &provider),
        async {
            provider.started.notified().await;
            control.request(REQUEST_CANCEL);
        }
    );
    result.unwrap();
    let db = handle.state::<Db>();
    let runs = handle.state::<AgentRuns>();
    {
        let conn = db.0.lock().unwrap();
        assert_eq!(
            get_record(&conn, RUNS, &run_id).unwrap().unwrap()["status"],
            "cancelled"
        );
        assert_eq!(
            step_by_key(&conn, &run_id, "extract_material_1").unwrap()["status"],
            "succeeded"
        );
        assert_eq!(
            step_by_key(&conn, &run_id, "write_material_report").unwrap()["status"],
            "pending"
        );
        assert!(related(&conn, ARTIFACTS, "runId", &run_id)
            .unwrap()
            .is_empty());
    }
    assert!(initialize_resume(&handle, &db, &runs, &run_id).is_err());
    {
        let mut conn = db.0.lock().unwrap();
        let task = get_record(&conn, TASKS, &task_id).unwrap().unwrap();
        assert!(prepare_new_run(&mut conn, &task).is_err());
    }
    let (_, new_run_id) = seed_material_run(&handle);
    assert_ne!(new_run_id, run_id);
    execute_run_with(&handle, &new_run_id, &RunControl::new(), &provider)
        .await
        .unwrap();
    assert_eq!(
        get_record(&db.0.lock().unwrap(), RUNS, &new_run_id)
            .unwrap()
            .unwrap()["status"],
        "succeeded"
    );
    assert_eq!(provider.calls.load(Ordering::SeqCst), 5);
    std::fs::remove_dir_all(root).unwrap();
}
