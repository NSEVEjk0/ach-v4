use std::{io::{self,Read},time::{SystemTime,UNIX_EPOCH}};
fn main(){
    let mut input=Vec::new();
    let result=(||{
        io::stdin().take(32_769).read_to_end(&mut input).map_err(|_|"PRIVATE_INPUT_INVALID".to_string())?;
        let secret=std::env::var("PROTECTED_INVOICE_KEY").map_err(|_|"PRIVATE_KEY_UNAVAILABLE".to_string())?;
        let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"PRIVATE_CLOCK_UNAVAILABLE".to_string())?.as_millis() as u64;
        ach_private_netting::execute(&input,&secret,now)
    })();
    match result{Ok(output)=>println!("{}",output),Err(code)=>println!("{}",serde_json::json!({"error":code,"protocol_version":4}))}
}
