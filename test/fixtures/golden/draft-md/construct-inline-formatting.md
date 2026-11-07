**bold** *italic* ~~strike~~ `code` [link](https://example.com)

***both*** **~~x~~** [**bold link**](https://example.com/a)

_text_ underscores stay, 2 \* 3 stays, a \*\* b stays

\*\*never closes and \*also never

```substack-node
{
  "type": "paragraph",
  "attrs": {
    "textAlign": null
  },
  "content": [
    {
      "type": "text",
      "text": "x",
      "marks": [
        {
          "type": "strong"
        },
        {
          "type": "code"
        }
      ]
    },
    {
      "type": "text",
      "text": " and "
    },
    {
      "type": "text",
      "text": "x",
      "marks": [
        {
          "type": "link",
          "attrs": {
            "target": "_blank",
            "rel": "noopener noreferrer nofollow",
            "class": null,
            "href": "https://x.example"
          }
        },
        {
          "type": "code"
        }
      ]
    }
  ]
}
```

a** x **b and *a ****b**** c* and ***a**** b*

[a](https://x/\(y\)) [b](https://x/\(z) \[c\](url "title")
