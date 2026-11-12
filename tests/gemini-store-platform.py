import importlib.util,json,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('platform',Path(__file__).resolve().parents[1]/'scripts/gemini-store-platform.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
class Parse(unittest.TestCase):
 def test_accepts_only_exact_valid_results(self):
  good={'de':{'short':'Natürlich lesen','intro':'Brand liest Webseiten.'}}
  self.assertEqual(p.parse_result('Antwort\n'+json.dumps(good),['de'],'Brand'),good)
  for bad in ({'de':{'short':'Linux','intro':'Brand reads'}},{'de':{'short':'x'*133,'intro':'Brand reads'}},{'fr':{'short':'ok','intro':'Brand reads'}}):
   with self.assertRaises(ValueError):p.parse_result(json.dumps(bad),['de'],'Brand')
if __name__=='__main__':unittest.main()
