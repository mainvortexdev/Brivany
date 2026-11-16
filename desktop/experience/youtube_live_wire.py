"""Fields used from YouTube's public StreamList protobuf definition.

https://developers.google.com/youtube/data/live/streaming-live-chat#stream_list.proto
Unknown fields are handled by protobuf. No protoc or generated runtime tooling is needed.
"""
from functools import lru_cache


RPC = '/youtube.api.v3.V3DataLiveChatMessageService/StreamList'


@lru_cache(maxsize=1)
def stream_types():
    from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

    package = 'youtube.api.v3'
    spec = descriptor_pb2.FileDescriptorProto(name='brivany/youtube_live.proto', package=package, syntax='proto2')
    field_type = descriptor_pb2.FieldDescriptorProto
    string, integer = field_type.TYPE_STRING, field_type.TYPE_INT32

    def message(name, *fields):
        declaration = spec.message_type.add(name=name)
        for field_name, number, kind, *repeated in fields:
            field = declaration.field.add(name=field_name, number=number, label=(
                field_type.LABEL_REPEATED if repeated else field_type.LABEL_OPTIONAL))
            if isinstance(kind, str):
                field.type = field_type.TYPE_MESSAGE
                field.type_name = f'.{package}.{kind}'
            else:
                field.type = kind

    message('LiveChatMessageListRequest', ('live_chat_id', 1, string), ('hl', 2, string),
            ('page_token', 99, string), ('part', 100, string, True))
    message('LiveChatMessageListResponse', ('offline_at', 2, string), ('next_page_token', 100602, string),
            ('items', 1007, 'LiveChatMessage', True))
    message('LiveChatMessage', ('id', 101, string), ('snippet', 2, 'LiveChatMessageSnippet'),
            ('author_details', 3, 'LiveChatMessageAuthorDetails'))
    message('LiveChatMessageAuthorDetails', ('channel_id', 10101, string), ('display_name', 103, string))
    message('LiveChatMessageSnippet', ('type', 1, integer), ('display_message', 16, string),
            ('author_channel_id', 301, string), ('text_message_details', 19, 'LiveChatTextMessageDetails'),
            ('user_banned_details', 22, 'LiveChatUserBannedMessageDetails'))
    message('LiveChatTextMessageDetails', ('message_text', 1, string))
    message('LiveChatUserBannedMessageDetails', ('banned_user_details', 1, 'ChannelProfileDetails'))
    message('ChannelProfileDetails', ('channel_id', 1, string))

    pool = descriptor_pool.DescriptorPool()
    pool.Add(spec)
    return tuple(message_factory.GetMessageClass(pool.FindMessageTypeByName(f'{package}.{name}'))
                 for name in ('LiveChatMessageListRequest', 'LiveChatMessageListResponse'))
