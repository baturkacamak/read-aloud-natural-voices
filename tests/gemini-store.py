import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('store',Path(__file__).resolve().parents[1]/'scripts/gemini-store.py')
store=importlib.util.module_from_spec(spec);spec.loader.exec_module(store)
class Validation(unittest.TestCase):
    def test_response_with_intro_and_outro(self):
        import json
        data={'en':{'title':'Read','short':'Listen','long':'Brand '+('x'*300)}}
        self.assertEqual(store.parse_listing('Intro\nJSON\n'+json.dumps(data)+'\nEnd',['en'],'Brand'),data)
    def test_validates_each_language_and_limits(self):
        good={'en':{'title':'Read aloud','short':'Read text aloud.','long':'Brand '+('Description. '*30)}}
        store.validate(good,['en'],'Brand')
        for item in ({}, {'en':{'title':'x'*46,'short':'ok','long':'Brand '+('x'*300)}}, {'en':{'title':'ok','short':'ok','long':'x'*300}}):
            with self.assertRaises(ValueError):store.validate(item,['en'],'Brand')
if __name__=='__main__':unittest.main()
