# Eligibility policy | eligibility-v2

Corpus version: `eligibility-v2`. This is synthetic prototype guidance, not Pakistani law or a real benefits determination.

## eligibility.who-can-claim

You can make a claim and are eligible for the relief payment when all four program rules are true for you. You must be alive according to the identity record, and your household must live in a program district. You must be a widow or have 5 or more people in your household, and your monthly household income must be below PKR 40,000.
آپ درخواست دے سکتے ہیں اور امدادی رقم کے حقدار ہیں جب پروگرام کی چاروں شرطیں آپ پر پوری ہوں۔ شناختی ریکارڈ کے مطابق آپ حیات ہوں، اور آپ کا گھرانہ پروگرام کے ضلع میں رہتا ہو۔ آپ بیوہ ہوں یا آپ کے گھر میں پانچ یا زیادہ افراد ہوں، اور آپ کے گھر کی ماہانہ آمدن چالیس ہزار روپے سے کم ہو۔

## eligibility.district

The program districts are Thatta, Sujawal, Badin, Tharparkar and Karachi West. A claim from another district is not refused by the software, it goes to an officer who checks it. These districts are examples for the prototype and are not real program coverage.
پروگرام کے ضلعے ٹھٹھہ، سجاول، بدین، تھرپارکر اور کراچی ویسٹ ہیں۔ کسی اور ضلع کی درخواست کو سافٹ ویئر رد نہیں کرتا، وہ افسر کے پاس جاتی ہے جو اسے دیکھتا ہے۔ یہ ضلعے صرف نمونے کی مثال ہیں، حقیقی پروگرام کے ضلعے نہیں۔

## eligibility.income

The income limit is PKR 40,000 per month for the whole household, not for one person. The program reads the household income and the number of members from the household record, with your permission. You do not need to bring an income paper.
آمدن کی حد پورے گھرانے کے لیے ماہانہ چالیس ہزار روپے ہے، ایک فرد کے لیے نہیں۔ پروگرام آپ کی اجازت سے گھر کی آمدن اور افراد کی تعداد گھرانے کے ریکارڈ سے دیکھتا ہے۔ آپ کو آمدن کا کوئی کاغذ لانے کی ضرورت نہیں۔

## eligibility.widow

A widow can get the payment even when her household is small, if the other rules are true. A person who is not a widow needs a household of 5 or more members. Only one claim per CNIC is accepted in one month.
بیوہ خاتون کو چھوٹے گھرانے کے ساتھ بھی رقم مل سکتی ہے، اگر باقی شرطیں پوری ہوں۔ جو شخص بیوہ نہیں، اس کے گھر میں پانچ یا زیادہ افراد ہونا ضروری ہے۔ ایک مہینے میں ایک شناختی کارڈ پر صرف ایک درخواست لی جاتی ہے۔

## eligibility.review

The software approves a claim by itself only when the rules are met and it is very sure about the identity. The software never rejects a claim, only a trained officer can say no. The AI never approves or rejects a claim, it only helps to fill in the form. When the software is not sure, an officer checks the claim.
سافٹ ویئر خود درخواست تب ہی منظور کرتا ہے جب شرطیں پوری ہوں اور شناخت پر پورا یقین ہو۔ سافٹ ویئر کبھی درخواست مسترد نہیں کرتا، انکار صرف تربیت یافتہ افسر کر سکتا ہے۔ مصنوعی ذہانت درخواست منظور یا مسترد نہیں کرتی، وہ صرف فارم بھرنے میں مدد کرتی ہے۔ جب سافٹ ویئر کو یقین نہ ہو تو افسر درخواست دیکھتا ہے۔
