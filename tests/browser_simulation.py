from pathlib import Path
from playwright.sync_api import sync_playwright
import re

root = Path(__file__).resolve().parents[1]
html = (root/'public/index.html').read_text()
html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
html = re.sub(r'<script[^>]*/?>', '', html, flags=re.S)
core = (root/'public/core.js').read_text()
app = (root/'public/app.js').read_text()
analytics = {"kpis":{"successRate":0,"transfers":0,"failedTransfers":0,"avgSpeedMbps":0,"avgGestureConfidence":0,"gestureUseRate":0},"recommendations":[],"recent":[],"byType":[]}


def bootstrap(page, camera=True):
    page.set_content(html, wait_until='domcontentloaded')
    script = """(analytics) => {
      window.fetch = async () => ({ ok:true, status:200, json: async () => analytics });
      window.Chart = function(){ this.destroy = () => {}; };
      window.confirm = () => true;
    """
    if camera:
        script += """
      const track = { stopped:false, stop(){ this.stopped=true; } };
      const fakeStream = { getTracks(){ return [track]; }, getVideoTracks(){ return [track]; } };
      Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{ getUserMedia: async () => fakeStream } });
      const video = document.getElementById('video');
      Object.defineProperty(video, 'srcObject', { configurable:true, writable:true, value:null });
      video.play = async () => {};
    """
    script += "}" 
    page.evaluate(script, analytics)
    page.add_script_tag(content=core)
    page.add_script_tag(content=app)
    page.wait_for_timeout(60)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    bootstrap(page)

    # 1. Sender default and role-specific controls.
    assert page.locator('.role-btn.active').inner_text().strip().endswith('Sender')
    assert page.locator('#startCameraBtn').is_enabled()
    assert page.locator('#copyBtn').is_visible()
    assert not page.locator('#pasteBtn').is_visible()

    # 2. Receiver also has camera/AI and the same gesture, but a different action.
    page.locator('.role-btn[data-role="receiver"]').click()
    assert page.locator('#startCameraBtn').is_enabled()
    assert not page.locator('#copyBtn').is_visible()
    assert page.locator('#pasteBtn').is_visible()
    assert page.locator('#pasteBtn').is_disabled()
    assert 'Open Hand' in page.locator('#statusText').inner_text()

    # 3. Webcam can start for Receiver independently of MediaPipe loading.
    page.locator('#startCameraBtn').click()
    page.wait_for_timeout(80)
    assert page.evaluate("document.getElementById('video').srcObject !== null")
    assert 'Camera Live' in page.locator('#cameraBadge').inner_text()
    page.locator('#stopCameraBtn').click()
    assert page.evaluate("document.getElementById('video').srcObject === null")

    # 4. Sender manual Air Copy rejects missing file/peer safely.
    page.locator('.role-btn[data-role="sender"]').click()
    page.locator('#copyBtn').click(force=True)
    # disabled without file; directly call to exercise guardrail
    page.evaluate("prepareAirCopy('manual')")
    assert 'Choose a file' in page.locator('#toast').inner_text()

    # 5. Pure universal gesture sequence is Open Palm -> Closed Fist.
    result = page.evaluate("""() => {
      const a = AirGestureCore.transitionAirGesture({}, 'Open_Palm', 1000, 2600);
      const b = AirGestureCore.transitionAirGesture(a, 'Closed_Fist', 1600, 2600);
      const c = AirGestureCore.transitionAirGesture({}, 'Closed_Fist', 1000, 2600);
      return [a.phase, b.fired, c.fired];
    }""")
    assert result == ['waiting-close', True, False]

    # 6. Sender: Air Copy sends metadata request only; actual payload waits for Receiver Air Paste.
    sender_proto = page.evaluate("""async () => {
      const sent=[];
      const fake={readyState:'open', bufferedAmount:0, bufferedAmountLowThreshold:0,
        send(x){sent.push(x)}, addEventListener(){}, close(){}};
      configureDataChannel(fake);
      selectFile(new File([new Uint8Array(150000)], 'week1-demo.bin', {type:'application/octet-stream'}));
      prepareAirCopy('gesture');
      const request = sent.filter(x => typeof x === 'string').map(x => JSON.parse(x)).find(x => x.type === 'transfer-request');
      const binaryBeforeAccept = sent.filter(x => x instanceof ArrayBuffer).length;
      await handleDataMessage({data:JSON.stringify({type:'transfer-accept', transferId:request.transferId})});
      const parsed = sent.filter(x => typeof x === 'string').map(x => JSON.parse(x));
      const meta=parsed.find(x => x.type === 'meta');
      const end=parsed.find(x => x.type === 'end');
      const binaryBytes=sent.filter(x => x instanceof ArrayBuffer).reduce((n,x) => n+x.byteLength,0);
      await handleDataMessage({data: JSON.stringify({type:'ack', transferId:request.transferId, name:request.name, bytes:request.size})});
      return {requestType:request.type, binaryBeforeAccept, idsMatch:request.transferId===meta.transferId && meta.transferId===end.transferId,
        declared:meta.size, binaryBytes, finalState:document.getElementById('transferState').textContent};
    }""")
    assert sender_proto['requestType'] == 'transfer-request'
    assert sender_proto['binaryBeforeAccept'] == 0
    assert sender_proto['idsMatch'] is True
    assert sender_proto['declared'] == sender_proto['binaryBytes'] == 150000
    assert sender_proto['finalState'] == 'COMPLETE'

    # 7. Receiver: request appears first, Air Paste acceptance is explicit, then bytes reconstruct and ACK.
    page2 = browser.new_page(); bootstrap(page2)
    page2.locator('.role-btn[data-role="receiver"]').click()
    receiver_proto = page2.evaluate("""async () => {
      const sent=[]; const fake={readyState:'open', binaryType:'arraybuffer', bufferedAmount:0, bufferedAmountLowThreshold:0,
        send(x){sent.push(x)}, addEventListener(){}, close(){}};
      configureDataChannel(fake);
      const id='test-transfer-1';
      await handleDataMessage({data:JSON.stringify({type:'transfer-request',transferId:id,name:'received.bin',size:6,mime:'application/octet-stream',fileType:'other'})});
      const beforeAccept=document.getElementById('transferState').textContent;
      acceptAirPaste('gesture');
      const accept=sent.filter(x=>typeof x==='string').map(x=>JSON.parse(x)).find(x=>x.type==='transfer-accept');
      await handleDataMessage({data:JSON.stringify({type:'meta',transferId:id,name:'received.bin',size:6,mime:'application/octet-stream'})});
      await handleDataMessage({data:new Uint8Array([1,2,3]).buffer});
      await handleDataMessage({data:new Uint8Array([4,5,6]).buffer});
      await handleDataMessage({data:JSON.stringify({type:'end',transferId:id})});
      const ack=sent.filter(x=>typeof x==='string').map(x=>JSON.parse(x)).find(x=>x.type==='ack');
      return {beforeAccept, acceptId:accept?.transferId, ackId:ack?.transferId, bytes:ack?.bytes,
        receivedCount:document.getElementById('receivedCount').textContent, finalState:document.getElementById('transferState').textContent};
    }""")
    assert receiver_proto == {'beforeAccept':'INCOMING REQUEST','acceptId':'test-transfer-1','ackId':'test-transfer-1','bytes':6,'receivedCount':'1','finalState':'RECEIVED'}
    page2.close()

    # 8. Receiver rejects truncated accepted payload with NACK.
    page3 = browser.new_page(); bootstrap(page3)
    page3.locator('.role-btn[data-role="receiver"]').click()
    truncated = page3.evaluate("""async () => {
      const sent=[]; const fake={readyState:'open',send(x){sent.push(x)},addEventListener(){},close(){}}; configureDataChannel(fake);
      const id='bad-1';
      await handleDataMessage({data:JSON.stringify({type:'transfer-request',transferId:id,name:'bad.bin',size:10,mime:'application/octet-stream'})});
      acceptAirPaste('manual');
      await handleDataMessage({data:JSON.stringify({type:'meta',transferId:id,name:'bad.bin',size:10,mime:'application/octet-stream'})});
      await handleDataMessage({data:new Uint8Array([1,2,3]).buffer});
      await handleDataMessage({data:JSON.stringify({type:'end',transferId:id})});
      const nack=sent.filter(x=>typeof x==='string').map(x=>JSON.parse(x)).find(x=>x.type==='nack');
      return {nack:!!nack, receivedCount:document.getElementById('receivedCount').textContent, state:document.getElementById('transferState').textContent};
    }""")
    assert truncated == {'nack':True,'receivedCount':'0','state':'FAILED'}
    page3.close()


    # 9. Broadcast Sender uploads exactly once and receives live classroom stats.
    page_b1 = browser.new_page(); bootstrap(page_b1)
    broadcast_sender = page_b1.evaluate("""async () => {
      setMode('broadcast');
      setRole('sender');
      state.room='DBA802';
      state.ws={readyState:1, send() {}, close() {}};
      state.broadcastHostToken='host-token';
      class FakeXHR {
        constructor(){ this.upload={}; this.responseType=''; this.status=0; this.response=null; }
        open(){}
        setRequestHeader(){}
        send(file){
          this.upload.onprogress?.({lengthComputable:true,loaded:file.size,total:file.size});
          this.status=201;
          this.response={file:{id:'broadcast-1',name:file.name,size:file.size,mime:file.type},
            stats:{connected:350,accepted:0,completed:0,failed:0,waiting:350,completionRate:0}};
          setTimeout(()=>this.onload?.(),0);
        }
        abort(){ this.onabort?.(); }
      }
      window.XMLHttpRequest=FakeXHR;
      selectFile(new File([new Uint8Array(2048)], 'class-case.pdf', {type:'application/pdf'}));
      await prepareBroadcastAirCopy('gesture');
      return {
        mode: state.mode,
        fileId: state.broadcastFileId,
        connected: document.getElementById('broadcastConnected').textContent,
        waiting: document.getElementById('broadcastWaiting').textContent,
        finalState: document.getElementById('transferState').textContent
      };
    }""")
    assert broadcast_sender == {'mode':'broadcast','fileId':'broadcast-1','connected':'350','waiting':'350','finalState':'WAITING RECEIVERS'}
    page_b1.close()

    # 10. Broadcast Receiver Air Pastes independently and reports completion.
    page_b2 = browser.new_page(); bootstrap(page_b2)
    broadcast_receiver = page_b2.evaluate("""async () => {
      setMode('broadcast');
      setRole('receiver');
      const sent=[];
      state.room='DBA802';
      state.ws={readyState:1, send(x){sent.push(JSON.parse(x))}, close(){}};
      renderBroadcastStats({connected:350,accepted:50,completed:45,failed:1,waiting:150,completionRate:22.5});
      applyBroadcastFile({id:'broadcast-1',name:'case.bin',size:6,mime:'application/octet-stream',sha256:''});
      window.fetch=async (url,opts={}) => {
        if (String(url).includes('/api/broadcast/') && String(url).includes('/files/')) {
          return new Response(new Uint8Array([1,2,3,4,5,6]), {status:200,headers:{'content-length':'6','content-type':'application/octet-stream'}});
        }
        return new Response(JSON.stringify({ok:true}), {status:201,headers:{'content-type':'application/json'}});
      };
      await acceptBroadcastAirPaste('gesture');
      return {
        accepted: sent.some(x=>x.type==='broadcast-accept'),
        completed: sent.some(x=>x.type==='broadcast-complete'),
        receivedCount: document.getElementById('receivedCount').textContent,
        finalState: document.getElementById('transferState').textContent
      };
    }""")
    assert broadcast_receiver == {'accepted':True,'completed':True,'receivedCount':'1','finalState':'RECEIVED'}
    page_b2.close()

    # 11. Camera permission denial is explained for either role; manual protocol remains independent.
    page4 = browser.new_page()
    page4.set_content(html, wait_until='domcontentloaded')
    page4.evaluate("""(analytics) => {
      window.fetch=async()=>({ok:true,status:200,json:async()=>analytics}); window.Chart=function(){this.destroy=()=>{}}; window.confirm=()=>true;
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{const e=new Error('denied');e.name='NotAllowedError';throw e;}}});
    }""", analytics)
    page4.add_script_tag(content=core); page4.add_script_tag(content=app)
    page4.locator('.role-btn[data-role="receiver"]').click()
    page4.locator('#startCameraBtn').click(); page4.wait_for_timeout(50)
    assert 'permission was denied' in page4.locator('#statusText').inner_text().lower()
    page4.close()

    print('BROWSER_SIMULATION_PASS', {
      'same_gesture_both_roles': True,
      'receiver_camera_enabled': True,
      'camera_first_startup': True,
      'manual_guardrails': True,
      'gesture_sequence': result,
      'sender_waits_for_acceptance': sender_proto,
      'receiver_accepts_then_receives': receiver_proto,
      'truncated_payload_rejected': truncated,
      'universal_sender_350_stats': broadcast_sender,
      'broadcast_receiver_air_paste': broadcast_receiver,
      'camera_permission_denial_handled': True,
      'page_errors': errors,
    })
    assert not errors, errors
    browser.close()
