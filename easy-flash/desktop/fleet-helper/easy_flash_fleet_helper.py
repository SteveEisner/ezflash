#!/usr/bin/env python3
"""Thin NDJSON adapter over Steve's committed native-v49 fleet pull workflow."""
import argparse,json,pathlib,sys,time
HERE=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import fleet_pull_update as pull
RELEASE=49;PROFILES={(1,0):('Dig2Go','esp32_quinled_dig2go_tubes.bin','DIG2GO_TUBES'),(2,0):('S3 Matrix M1','esp32-s3-matrix-m1_tubes.bin','ESP32-S3_MATRIX_M1'),(3,0):('Athom C3','esp32-c3-athom_tubes.bin','ESP32-C3_ATHOM_TUBES')}
def emit(value):print(json.dumps(value),flush=True)
def ports():return sorted(set(pathlib.Path('/dev').glob('cu.usbmodem*'))|set(pathlib.Path('/dev').glob('cu.usbserial*')))
def manifest(port=None):
 last='no USB controller returned a nonce-bound fleet manifest'
 for candidate in [pathlib.Path(port)] if port else ports():
  try:return candidate,pull.load_manifest(candidate)
  except Exception as error:last=str(error)
 raise RuntimeError(last)
def shape(d):
 key=(int(d['family']),int(d['variant']));profile=PROFILES.get(key);version=int(d['tubes']);eligible=bool(profile) and 22<=version<RELEASE
 state='eligible' if eligible else ('skipped — already v49' if profile and version==RELEASE else 'failed closed — unknown, mismatched, legacy, or newer target')
 return {'mac':str(d['mac']),'deviceId':f"0x{int(d['node']):04X}",'model':profile[0] if profile else f'unknown family {key[0]} variant {key[1]}','version':version,'lastHeard':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'reachability':'nonce-bound mesh report','artifact':f'{profile[0]} ordinary v49' if profile else None,'eligible':eligible,'state':state}
def scan():
 port,devices=manifest();emit({'type':'scan','serialPath':str(port),'devices':[shape(d) for d in devices]})
def update(args):
 port,devices=manifest(args.serial);wanted=set(args.devices.split(','));chosen=[d for d in devices if str(d['mac']) in wanted]
 if not wanted or {str(d['mac']) for d in chosen}!=wanted:raise RuntimeError('selected device disappeared or identity changed')
 eligible=[d for d in chosen if shape(d)['eligible']]
 for d in chosen:
  state=shape(d)['state'];emit({'type':'event','mac':str(d['mac']),'state':'queued' if d in eligible else state})
 if not eligible:emit({'type':'result','ok':True});return
 original=pull.load_manifest;pull.load_manifest=lambda serial,timeout=7.0:eligible if timeout==7.0 else original(serial,timeout);pull.IMAGE_PROFILES=dict(pull.IMAGE_PROFILES);pull.IMAGE_PROFILES[(2,0)]=pull.ImageProfile('esp32-s3-matrix-m1_tubes.bin','ESP32-S3_MATRIX_M1')
 for d in eligible:emit({'type':'event','mac':str(d['mac']),'state':'serving / transferring'})
 ns=argparse.Namespace(serial=port,firmware_dir=HERE/'firmware',stored_network=True,ssid='',bind=args.advertise,port=0,advertise=args.advertise,canary_mac=None,start_window_ms=0,transfer_timeout=180.0,verify_timeout=180.0)
 try:
  pull.run_wave(ns)
  for d in eligible:emit({'type':'event','mac':str(d['mac']),'state':'succeeded — transfer and reboot identity verified'})
  emit({'type':'result','ok':True})
 except Exception as error:
  for d in eligible:emit({'type':'event','mac':str(d['mac']),'state':f'failed — {error}'})
  raise
def main():
 parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True);sub.add_parser('scan');u=sub.add_parser('update');u.add_argument('--serial',required=True);u.add_argument('--advertise',required=True);u.add_argument('--devices',required=True);args=parser.parse_args()
 try:scan() if args.command=='scan' else update(args)
 except Exception as error:emit({'type':'error','message':str(error)});sys.exit(1)
if __name__=='__main__':main()
